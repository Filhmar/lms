import { Injectable } from "@nestjs/common";
import type { ProvisioningRowError, ScopeLevel } from "@rl/schemas";
import { PrismaService } from "../../platform/prisma.service";
import type { ProvisioningJob } from "../../generated/prisma/client";

/**
 * prov.jobs is the SOURCE OF TRUTH for job state — BullMQ is transport only
 * (a Redis failover must never lose import state). TECHSTACK §5.3.
 */
@Injectable()
export class ProvisioningRepository {
  constructor(private readonly prisma: PrismaService) {}

  createJob(input: {
    id: string;
    targetScopeId: string;
    filePath: string;
    createdBy: string;
  }): Promise<ProvisioningJob> {
    return this.prisma.client.provisioningJob.create({
      data: { ...input, kind: "bulk_import", status: "queued" },
    });
  }

  findJobById(id: string): Promise<ProvisioningJob | null> {
    return this.prisma.client.provisioningJob.findUnique({ where: { id } });
  }

  /** Level of the import's target scope (role↔level checks are per row). */
  async findScopeLevel(scopeId: string): Promise<ScopeLevel | null> {
    const result = await this.prisma.pool.query<{ level: ScopeLevel }>(
      `SELECT level FROM org.scopes WHERE id = $1::uuid`,
      [scopeId],
    );
    return result.rows[0]?.level ?? null;
  }

  async markProcessing(id: string): Promise<void> {
    await this.prisma.client.provisioningJob.update({
      where: { id },
      data: { status: "processing" },
    });
  }

  async markCompleted(
    id: string,
    progress: { total: number; success: number; failed: number },
    errors: ProvisioningRowError[],
  ): Promise<void> {
    await this.prisma.client.provisioningJob.update({
      where: { id },
      data: { status: "completed", ...progress, errors },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.client.provisioningJob.update({
      where: { id },
      data: { status: "failed", errors: [{ row: 0, reason }] },
    });
  }
}
