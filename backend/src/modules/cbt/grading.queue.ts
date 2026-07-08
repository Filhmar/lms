import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { RedisService } from "../../platform/redis.service";

export const CBT_GRADING_QUEUE_NAME = "cbt-grading";
export const GRADE_ATTEMPT_JOB = "grade-attempt";

/** Delay before grading so trailing answer drips (sent after submit) land. */
export const GRADING_DELAY_MS = 3_000;

export interface GradeAttemptJobData {
  attemptId: string;
}

/**
 * Thin BullMQ transport (same pattern as provisioning) — durable grading
 * state lives in cbt.attempts (Postgres is truth); a Redis failover can only
 * delay grading, never lose it (re-enqueue is idempotent).
 */
@Injectable()
export class GradingQueue implements OnModuleDestroy {
  private readonly logger = new Logger(GradingQueue.name);
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(redisService: RedisService) {
    this.connection = redisService.createBullConnection();
    this.queue = new Queue(CBT_GRADING_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueueGrading(attemptId: string): Promise<void> {
    await this.queue.add(
      GRADE_ATTEMPT_JOB,
      { attemptId } satisfies GradeAttemptJobData,
      {
        jobId: attemptId, // idempotent: one grading job per attempt
        delay: GRADING_DELAY_MS,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch((e) => this.logger.warn(String(e)));
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
