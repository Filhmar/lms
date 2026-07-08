import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { EncryptedEnvelopeSchema } from "@rl/schemas";
import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { PrismaService } from "../../platform/prisma.service";
import { RedisService } from "../../platform/redis.service";
import { decryptEnvelope } from "./exam-crypto";
import { KEY_PROVIDER, type KeyProvider } from "./key-provider";
import {
  CBT_GRADING_QUEUE_NAME,
  GRADE_ATTEMPT_JOB,
  type GradeAttemptJobData,
} from "./grading.queue";

interface QuestionRow {
  id: string;
  type: string;
  correct: unknown; // option id (mcq/tf) | accepted strings (ident)
  weight: number;
}

interface AnswerRow {
  question_id: string;
  envelope: unknown;
}

/**
 * Grading worker. Registered IN-PROCESS like the provisioning processor —
 * extracting both to the dedicated ./worker deployable is the documented
 * later step (TECHSTACK topology); this handler only touches Postgres and
 * the KeyProvider, so it moves as-is.
 *
 * Pipeline: attempt(submitted) → state=grading → decrypt each answer
 * envelope (RSA-OAEP-SHA256 unwrap + AES-256-GCM) via the KeyProvider →
 * grade (mcq/tf exact option-id match; ident case/whitespace-insensitive
 * membership) → score_raw/score_total (weighted), state=graded.
 * Missing/undecryptable answers score 0 with a logged warning — a corrupt
 * envelope must never crash the job.
 */
@Injectable()
export class GradingProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GradingProcessor.name);
  private connection?: Redis;
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @Inject(KEY_PROVIDER) private readonly keyProvider: KeyProvider,
  ) {}

  onModuleInit(): void {
    this.connection = this.redisService.createBullConnection();
    this.worker = new Worker(
      CBT_GRADING_QUEUE_NAME,
      async (job) => this.process(job as Job<GradeAttemptJobData>),
      { connection: this.connection, concurrency: 2 },
    );
    this.worker.on("failed", (job, err) => {
      this.logger.error(
        `grading job for attempt ${(job?.data as GradeAttemptJobData | undefined)?.attemptId} failed: ${err.message}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch((e) => this.logger.warn(String(e)));
    if (this.connection) {
      await this.connection.quit().catch(() => this.connection?.disconnect());
    }
  }

  private async process(job: Job<GradeAttemptJobData>): Promise<void> {
    if (job.name !== GRADE_ATTEMPT_JOB) return;
    const { attemptId } = job.data;

    const attemptRes = await this.prisma.pool.query<{
      id: string;
      exam_id: string;
      state: string;
      key_version: number;
    }>(
      `SELECT a.id, a.exam_id, a.state, e.key_version
       FROM cbt.attempts a
       JOIN cbt.exams e ON e.id = a.exam_id
       WHERE a.id = $1::uuid`,
      [attemptId],
    );
    const attempt = attemptRes.rows[0];
    if (!attempt) {
      this.logger.warn(`attempt ${attemptId} not found — dropping grading job`);
      return;
    }
    if (attempt.state === "graded") return; // idempotent replay
    if (attempt.state !== "submitted" && attempt.state !== "grading") {
      this.logger.warn(
        `attempt ${attemptId} is ${attempt.state} — not gradeable, dropping job`,
      );
      return;
    }

    await this.prisma.pool.query(
      `UPDATE cbt.attempts SET state = 'grading' WHERE id = $1::uuid`,
      [attemptId],
    );

    const privateKeyPem = await this.keyProvider.getPrivateKeyPem(
      attempt.exam_id,
      attempt.key_version,
    );

    const [questions, answers] = await Promise.all([
      this.prisma.pool.query<QuestionRow>(
        `SELECT id, type, correct, weight FROM cbt.questions WHERE exam_id = $1::uuid`,
        [attempt.exam_id],
      ),
      this.prisma.pool.query<AnswerRow>(
        `SELECT question_id, envelope FROM cbt.answers WHERE attempt_id = $1::uuid`,
        [attemptId],
      ),
    ]);
    const answerByQuestion = new Map(
      answers.rows.map((a) => [a.question_id, a.envelope]),
    );

    let scoreRaw = 0;
    let scoreTotal = 0;
    for (const question of questions.rows) {
      scoreTotal += question.weight;
      const envelope = answerByQuestion.get(question.id);
      if (envelope === undefined) continue; // unanswered = 0, not a warning

      const value = this.decryptAnswerValue(attemptId, question.id, envelope, {
        privateKeyPem,
        expectedKeyVersion: attempt.key_version,
      });
      if (value === null) continue; // undecryptable = 0 (already warned)
      if (isCorrect(question, value)) scoreRaw += question.weight;
    }

    await this.prisma.pool.query(
      `UPDATE cbt.attempts
       SET state = 'graded', score_raw = $2, score_total = $3, graded_at = now()
       WHERE id = $1::uuid`,
      [attemptId, scoreRaw, scoreTotal],
    );
    this.logger.log(`graded attempt ${attemptId}: ${scoreRaw}/${scoreTotal}`);
  }

  /** Envelope → plaintext { value } — null (plus a warning) on any failure. */
  private decryptAnswerValue(
    attemptId: string,
    questionId: string,
    rawEnvelope: unknown,
    key: { privateKeyPem: string; expectedKeyVersion: number },
  ): string | null {
    const warn = (why: string) =>
      this.logger.warn(
        `attempt ${attemptId} question ${questionId}: ${why} — scoring 0`,
      );
    const envelope = EncryptedEnvelopeSchema.safeParse(rawEnvelope);
    if (!envelope.success) {
      warn("stored envelope is malformed");
      return null;
    }
    if (envelope.data.keyVersion !== key.expectedKeyVersion) {
      warn(
        `envelope key version ${envelope.data.keyVersion} != exam key version ${key.expectedKeyVersion}`,
      );
      return null;
    }
    try {
      const plaintext = decryptEnvelope(envelope.data, key.privateKeyPem);
      const parsed: unknown = JSON.parse(plaintext);
      const value = (parsed as { value?: unknown })?.value;
      if (typeof value !== "string") {
        warn("plaintext is not { value: string }");
        return null;
      }
      return value;
    } catch (err) {
      warn(`undecryptable answer (${err instanceof Error ? err.message : String(err)})`);
      return null;
    }
  }
}

/** mcq/tf: exact option-id match. ident: normalized membership in accepted. */
function isCorrect(question: QuestionRow, value: string): boolean {
  if (question.type === "ident") {
    if (!Array.isArray(question.correct)) return false;
    const normalized = normalize(value);
    return question.correct.some(
      (accepted) => typeof accepted === "string" && normalize(accepted) === normalized,
    );
  }
  return typeof question.correct === "string" && question.correct === value;
}

/** Case/whitespace-insensitive: trim, lowercase, collapse inner whitespace. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
