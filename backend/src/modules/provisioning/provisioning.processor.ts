import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { UserRoles, type ProvisioningRowError } from "@rl/schemas";
import { Worker, type Job } from "bullmq";
import { parse } from "csv-parse";
import type Redis from "ioredis";
import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { z } from "zod";
import { PrismaService } from "../../platform/prisma.service";
import { RedisService } from "../../platform/redis.service";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../platform/storage/object-storage.port";
import {
  BULK_IMPORT_JOB,
  PROVISIONING_QUEUE_NAME,
  type BulkImportJobData,
} from "./provisioning.queue";
import { ProvisioningRepository } from "./provisioning.repository";

const emailSchema = z.email();
const roleSet = new Set<string>(UserRoles);

interface ValidRow {
  rowNum: number; // 1-based data row (header excluded)
  email: string;
  fullName: string;
  role: string;
}

/**
 * Bulk-import processor. Registered IN-PROCESS for Phase I; extracting it to
 * a dedicated ./worker deployable is the documented later step (TECHSTACK
 * topology) — the handler only touches Postgres/storage, so it moves as-is.
 *
 * Pipeline: stream-parse CSV → sanitize/validate → COPY into an UNLOGGED
 * staging table → set-based INSERT ... ON CONFLICT (email) DO NOTHING →
 * per-row errors (invalid + duplicates) → prov.jobs updated (Postgres is truth).
 */
@Injectable()
export class ProvisioningProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProvisioningProcessor.name);
  private connection?: Redis;
  private worker?: Worker;

  constructor(
    private readonly repo: ProvisioningRepository,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  onModuleInit(): void {
    this.connection = this.redisService.createBullConnection();
    this.worker = new Worker(
      PROVISIONING_QUEUE_NAME,
      async (job) => this.process(job as Job<BulkImportJobData>),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(
        `bulk-import job ${(job?.data as BulkImportJobData | undefined)?.jobId} failed: ${err.message}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch((e) => this.logger.warn(String(e)));
    if (this.connection) {
      await this.connection.quit().catch(() => this.connection?.disconnect());
    }
  }

  private async process(job: Job<BulkImportJobData>): Promise<void> {
    if (job.name !== BULK_IMPORT_JOB) return;
    const { jobId } = job.data;
    const row = await this.repo.findJobById(jobId);
    if (!row) {
      this.logger.warn(`prov.jobs row ${jobId} not found — dropping queue job`);
      return;
    }
    if (row.status === "completed") return; // idempotent replay

    await this.repo.markProcessing(jobId);
    try {
      const { total, validRows, errors } = await this.parseAndValidate(row.filePath);
      const insertedEmails = await this.bulkInsert(jobId, row.targetScopeId, validRows);

      // Rows that survived validation but hit ON CONFLICT are duplicates.
      for (const valid of validRows) {
        if (!insertedEmails.has(valid.email)) {
          errors.push({ row: valid.rowNum, reason: "User already exists" });
        }
      }
      errors.sort((a, b) => a.row - b.row);

      await this.repo.markCompleted(
        jobId,
        { total, success: insertedEmails.size, failed: errors.length },
        errors,
      );
      this.logger.log(
        `bulk-import ${jobId}: total=${total} success=${insertedEmails.size} failed=${errors.length}`,
      );
    } catch (err) {
      await this.repo
        .markFailed(jobId, err instanceof Error ? err.message : String(err))
        .catch(() => undefined);
      throw err;
    }
  }

  /** Stream-parse (never load the whole file into memory as rows-of-strings-of-junk). */
  private async parseAndValidate(filePath: string): Promise<{
    total: number;
    validRows: ValidRow[];
    errors: ProvisioningRowError[];
  }> {
    const stream = await this.storage.getStream(filePath);
    const parser = stream.pipe(
      parse({
        bom: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }),
    );

    const validRows: ValidRow[] = [];
    const errors: ProvisioningRowError[] = [];
    const seenEmails = new Set<string>();
    let total = 0;
    let isHeader = true;

    for await (const record of parser as AsyncIterable<string[]>) {
      if (isHeader) {
        isHeader = false;
        const header = record.map((h) => h.trim().toLowerCase()).join(",");
        if (header !== "email,full_name,role") {
          throw new Error(`Unexpected CSV header: ${header}`);
        }
        continue;
      }
      total += 1;
      const rowNum = total;

      const [rawEmail = "", rawFullName = "", rawRole = ""] = record;
      const email = rawEmail.trim().toLowerCase();
      const fullName = rawFullName.trim();
      const role = rawRole.trim().toLowerCase();

      if (record.length !== 3) {
        errors.push({ row: rowNum, reason: "Expected exactly 3 columns" });
        continue;
      }
      if (!emailSchema.safeParse(email).success) {
        errors.push({ row: rowNum, reason: "Invalid email format" });
        continue;
      }
      if (!fullName) {
        errors.push({ row: rowNum, reason: "Missing full_name" });
        continue;
      }
      if (!roleSet.has(role)) {
        errors.push({ row: rowNum, reason: `Invalid role: ${role}` });
        continue;
      }
      if (seenEmails.has(email)) {
        errors.push({ row: rowNum, reason: "Duplicate email in file" });
        continue;
      }
      seenEmails.add(email);
      validRows.push({ rowNum, email, fullName, role });
    }

    return { total, validRows, errors };
  }

  /**
   * COPY → UNLOGGED staging table → set-based insert. Returns the emails
   * actually inserted; conflicts (existing users) are reported by the caller.
   */
  private async bulkInsert(
    jobId: string,
    targetScopeId: string,
    rows: ValidRow[],
  ): Promise<Set<string>> {
    if (rows.length === 0) return new Set();

    // Job-unique staging table name (uuid hex only — safe identifier).
    const suffix = jobId.replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/.test(suffix)) throw new Error("Invalid job id");
    const staging = `prov.staging_import_${suffix}`;

    const client = await this.prisma.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `CREATE UNLOGGED TABLE ${staging} (
           row_num   int  NOT NULL,
           email     text NOT NULL,
           full_name text NOT NULL,
           role      text NOT NULL
         )`,
      );

      const copyStream = client.query(
        copyFrom(
          `COPY ${staging} (row_num, email, full_name, role) FROM STDIN WITH (FORMAT csv)`,
        ),
      );
      await pipeline(Readable.from(toCsv(rows)), copyStream);

      const inserted = await client.query<{ email: string }>(
        `INSERT INTO auth.users (email, full_name, role, scope_id, status)
         SELECT s.email, s.full_name, s.role::auth.user_role, $1::uuid,
                'pending_activation'::auth.user_status
         FROM ${staging} s
         ORDER BY s.row_num
         ON CONFLICT (email) DO NOTHING
         RETURNING email`,
        [targetScopeId],
      );

      await client.query(`DROP TABLE ${staging}`);
      await client.query("COMMIT");
      return new Set(inserted.rows.map((r) => r.email));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

function* toCsv(rows: ValidRow[]): Generator<string> {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  for (const row of rows) {
    yield `${row.rowNum},${escape(row.email)},${escape(row.fullName)},${escape(row.role)}\n`;
  }
}
