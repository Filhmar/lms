import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AdminRoles, QuestionTypeSchema } from "@rl/schemas";
import type {
  AttemptState,
  AttemptStatusResponse,
  ExamListItem,
  ExamPackage,
  StartAttemptResponse,
  SyncBatchRequest,
  SyncBatchResponse,
  UserRole,
} from "@rl/schemas";
import type { AuthenticatedUser } from "../auth";
import { ScopeAccessService } from "../org-hierarchy";
import { CbtRepository, type AttemptRow, type ExamRow } from "./cbt.repository";
import { GradingQueue } from "./grading.queue";

/** Calm student-facing copy — no "sync"/"server"/"error" words. */
const NOT_OPEN_YET =
  "This exam isn't open yet. It will be ready to download when the window opens.";
const ALREADY_CLOSED = "This exam's window has closed.";
const ALREADY_SUBMITTED = "This exam has already been turned in — one attempt only.";

const adminRoleSet = new Set<UserRole>(AdminRoles);

@Injectable()
export class CbtService {
  constructor(
    private readonly repo: CbtRepository,
    private readonly scopeAccess: ScopeAccessService,
    private readonly gradingQueue: GradingQueue,
  ) {}

  /** GET /exams — the caller's visible exams with their own attempt folded in. */
  async listExams(actor: AuthenticatedUser): Promise<ExamListItem[]> {
    const rows = await this.repo.listVisibleExams(actor.scopeId, actor.sub);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      totalItems: row.total_items,
      durationMinutes: row.duration_minutes,
      opensAt: row.opens_at.toISOString(),
      closesAt: row.closes_at.toISOString(),
      attemptState: (row.attempt_state ?? "none") as AttemptState,
      attemptId: row.attempt_id,
      score: formatScore(row.attempt_state, row.score_raw, row.score_total),
      packageBytes: row.pkg_bytes,
    }));
  }

  /**
   * GET /exams/:id/package — the offline download. Same visibility rule as
   * the list; only available once the window opens. Correct answers and the
   * private key NEVER appear here (the repository never selects them).
   */
  async getPackage(examId: string, actor: AuthenticatedUser): Promise<ExamPackage> {
    const exam = await this.loadVisibleExam(examId, actor);
    if (new Date() < exam.opens_at) {
      throw new BadRequestException(NOT_OPEN_YET);
    }
    const questions = await this.repo.getPackageQuestions(examId);
    return {
      examId: exam.id,
      version: exam.version,
      title: exam.title,
      durationMinutes: exam.duration_minutes,
      closesAt: exam.closes_at.toISOString(),
      publicKeyPem: exam.public_key_pem,
      keyVersion: exam.key_version,
      questions: questions.map((q) => ({
        id: q.id,
        seq: q.seq,
        type: QuestionTypeSchema.parse(q.type),
        text: q.text,
        options: q.options,
      })),
    };
  }

  /**
   * POST /exams/:id/attempts — start, or return the existing in_progress
   * attempt idempotently (the PWA may retry after a crash). One attempt per
   * exam: submitted/grading/graded → 409.
   */
  async startAttempt(
    examId: string,
    actor: AuthenticatedUser,
  ): Promise<StartAttemptResponse> {
    const exam = await this.loadVisibleExam(examId, actor);
    const now = new Date();
    if (now < exam.opens_at) throw new BadRequestException(NOT_OPEN_YET);
    if (now >= exam.closes_at) throw new BadRequestException(ALREADY_CLOSED);

    const existing = await this.repo.findAttemptByExamUser(examId, actor.sub);
    if (existing) return this.toStartResponse(existing);

    // deadline = min(now + duration, closes_at) — server-anchored wall clock.
    const byDuration = new Date(now.getTime() + exam.duration_minutes * 60_000);
    const deadline = byDuration < exam.closes_at ? byDuration : exam.closes_at;

    const inserted = await this.repo.insertAttempt(examId, actor.sub, deadline);
    if (inserted) return this.toStartResponse(inserted);

    // Lost a same-instant race — the winner's row is the attempt.
    const raced = await this.repo.findAttemptByExamUser(examId, actor.sub);
    if (!raced) throw new NotFoundException("Attempt not found");
    return this.toStartResponse(raced);
  }

  /**
   * POST /sync/batch — drip sync. One transaction per batch; outcomes in
   * input order; grading jobs enqueue only after the transaction commits.
   */
  async syncBatch(
    body: SyncBatchRequest,
    actor: AuthenticatedUser,
  ): Promise<SyncBatchResponse> {
    const { results, submittedAttemptIds } = await this.repo.processSyncBatch(
      actor.sub,
      body.events,
    );
    for (const attemptId of submittedAttemptIds) {
      // ~3s delay lets trailing answer drips land before grading snapshots.
      await this.gradingQueue.enqueueGrading(attemptId);
    }
    return { results };
  }

  /**
   * GET /attempts/:id — the caller's own attempt; admins may view attempts
   * of students inside their subtree (one closure-set check — cheap).
   */
  async getAttemptStatus(
    attemptId: string,
    actor: AuthenticatedUser,
  ): Promise<AttemptStatusResponse> {
    const row = await this.repo.getAttemptStatus(attemptId);
    if (row && row.user_id !== actor.sub) {
      const adminInScope =
        adminRoleSet.has(actor.role) &&
        (await this.scopeAccess.canAccess(actor.scopeId, row.user_scope_id));
      if (!adminInScope) {
        // 404, not 403 — never confirm a foreign attempt id exists.
        throw new NotFoundException("Attempt not found");
      }
    }
    if (!row) throw new NotFoundException("Attempt not found");
    return {
      attemptId: row.id,
      examId: row.exam_id,
      state: row.state as AttemptState,
      answersReceived: row.answers_received,
      totalItems: row.total_items,
      submittedAt: row.submitted_at ? row.submitted_at.toISOString() : null,
      score: formatScore(row.state, row.score_raw, row.score_total),
    };
  }

  /** Visibility (downward inheritance) — invisible and nonexistent are both 404. */
  private async loadVisibleExam(
    examId: string,
    actor: AuthenticatedUser,
  ): Promise<ExamRow> {
    const exam = await this.repo.findVisibleExam(examId, actor.scopeId);
    if (!exam) throw new NotFoundException("Exam not found");
    return exam;
  }

  private toStartResponse(attempt: AttemptRow): StartAttemptResponse {
    if (attempt.state !== "in_progress") {
      throw new ConflictException(ALREADY_SUBMITTED);
    }
    return {
      attemptId: attempt.id,
      examId: attempt.exam_id,
      startedAt: attempt.started_at.toISOString(),
      deadlineAt: attempt.deadline_at.toISOString(),
    };
  }
}

function formatScore(
  state: string | null,
  raw: number | null,
  total: number | null,
): string | null {
  return state === "graded" && raw !== null && total !== null
    ? `${raw}/${total}`
    : null;
}
