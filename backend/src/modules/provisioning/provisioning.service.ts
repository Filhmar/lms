import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CSV_IMPORT_HEADER } from "@rl/schemas";
import type {
  BulkImportAccepted,
  ProvisioningJobStatus,
  ProvisioningRowError,
} from "@rl/schemas";
import type { AuthenticatedUser } from "../auth";
import { ScopeAccessService } from "../org-hierarchy";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../platform/storage/object-storage.port";
import { ProvisioningQueue } from "./provisioning.queue";
import { ProvisioningRepository } from "./provisioning.repository";

const EXPECTED_HEADER = CSV_IMPORT_HEADER.join(",");

/**
 * Async bulk import — the 202 pattern, never synchronous: validate structure
 * → save raw file via the ObjectStorage port → insert prov.jobs (queued) →
 * enqueue BullMQ → 202 with a status link. The worker does the heavy lifting.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    private readonly repo: ProvisioningRepository,
    private readonly queue: ProvisioningQueue,
    private readonly scopeAccess: ScopeAccessService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async acceptBulkImport(
    file: { originalname: string; buffer: Buffer; size: number },
    targetScopeId: string,
    actor: AuthenticatedUser,
  ): Promise<BulkImportAccepted> {
    // Scope check via closure table: the admin must sit at or above the
    // target scope (also rejects nonexistent scopes — not in any descendant set).
    const allowed = await this.scopeAccess.canAccess(actor.scopeId, targetScopeId);
    if (!allowed) {
      throw new ForbiddenException("Target scope is outside your hierarchy");
    }

    // Structural validation only (cheap): the header row must match exactly.
    const firstLine = file.buffer
      .subarray(0, 1024)
      .toString("utf8")
      .replace(/^﻿/, "")
      .split("\n", 1)[0]!
      .trim();
    if (firstLine !== EXPECTED_HEADER) {
      throw new BadRequestException(
        `Invalid CSV header. Expected exactly: ${EXPECTED_HEADER}`,
      );
    }

    const jobId = randomUUID();
    const filePath = `provisioning/${jobId}.csv`;
    await this.storage.put(filePath, file.buffer);
    await this.repo.createJob({
      id: jobId,
      targetScopeId,
      filePath,
      createdBy: actor.sub,
    });
    await this.queue.enqueueBulkImport(jobId);

    return {
      jobId,
      status: "queued",
      message: "File received. Processing started in the background.",
      links: { status: `/api/v1/provisioning/job/${jobId}` },
    };
  }

  async getJobStatus(
    jobId: string,
    actor: AuthenticatedUser,
  ): Promise<ProvisioningJobStatus> {
    const job = await this.repo.findJobById(jobId);
    if (!job) throw new NotFoundException("Job not found");

    const allowed = await this.scopeAccess.canAccess(actor.scopeId, job.targetScopeId);
    if (!allowed) throw new ForbiddenException("Job is outside your hierarchy");

    return {
      jobId: job.id,
      status: job.status,
      progress: { total: job.total, success: job.success, failed: job.failed },
      errors: (job.errors ?? []) as ProvisioningRowError[],
    };
  }
}
