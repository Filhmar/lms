import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { RedisService } from "../../platform/redis.service";

export const PROVISIONING_QUEUE_NAME = "provisioning";
export const BULK_IMPORT_JOB = "bulk-import";

export interface BulkImportJobData {
  jobId: string;
}

/** Thin BullMQ transport — durable job state lives in prov.jobs (Postgres). */
@Injectable()
export class ProvisioningQueue implements OnModuleDestroy {
  private readonly logger = new Logger(ProvisioningQueue.name);
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(redisService: RedisService) {
    this.connection = redisService.createBullConnection();
    this.queue = new Queue(PROVISIONING_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueueBulkImport(jobId: string): Promise<void> {
    await this.queue.add(
      BULK_IMPORT_JOB,
      { jobId },
      {
        jobId, // idempotent: one BullMQ job per prov.jobs row
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch((e) => this.logger.warn(String(e)));
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
