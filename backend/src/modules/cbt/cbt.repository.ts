import { Injectable } from "@nestjs/common";
import type { AnswerEvent, SubmitEvent } from "@rl/schemas";
import { PrismaService } from "../../platform/prisma.service";

/** The event kinds the cbt module owns. "progress" events are partitioned
 *  off by CbtService and handled by the courses module. */
export type CbtSyncEvent = AnswerEvent | SubmitEvent;

/* ------------------------------ row shapes ------------------------------ */

export interface ExamListRow {
  id: string;
  title: string;
  duration_minutes: number;
  opens_at: Date;
  closes_at: Date;
  total_items: number;
  pkg_bytes: number;
  attempt_id: string | null;
  attempt_state: string | null;
  score_raw: number | null;
  score_total: number | null;
}

export interface ExamRow {
  id: string;
  title: string;
  version: number;
  duration_minutes: number;
  opens_at: Date;
  closes_at: Date;
  key_version: number;
  public_key_pem: string;
}

export interface PackageQuestionRow {
  id: string;
  seq: number;
  type: string;
  text: string;
  options: Array<{ id: string; text: string }> | null;
}

export interface AttemptRow {
  id: string;
  exam_id: string;
  user_id: string;
  state: string;
  started_at: Date;
  deadline_at: Date;
}

export interface AttemptStatusRow {
  id: string;
  exam_id: string;
  user_id: string;
  user_scope_id: string;
  state: string;
  submitted_at: Date | null;
  score_raw: number | null;
  score_total: number | null;
  answers_received: number;
  total_items: number;
}

export interface SyncResult {
  id: string;
  outcome: "merged" | "stale" | "duplicate" | "rejected";
  reason?: string;
}

/** Grace window around the attempt for advisory client timestamps (ms). */
const CLIENT_TS_GRACE_MS = 2 * 60 * 1000;

/**
 * CBT data access. Hot paths (sync batch, list, package) are raw SQL on the
 * shared pg.Pool with fully-qualified table names (cbt.* / org.* / auth.*).
 */
@Injectable()
export class CbtRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Student-visible exams: downward inheritance — the exam's owner scope must
   * be an ANCESTOR-or-self of the caller's scope (single closure-table join;
   * lateral isolation falls out for free). Includes upcoming exams and those
   * recently closed/graded (30-day tail). packageBytes is a rough JSON size
   * estimate: question text + options + per-question overhead + public key.
   */
  async listVisibleExams(scopeId: string, userId: string): Promise<ExamListRow[]> {
    const result = await this.prisma.pool.query<ExamListRow>(
      `SELECT e.id, e.title, e.duration_minutes, e.opens_at, e.closes_at,
              count(q.id)::int AS total_items,
              (coalesce(sum(length(q.text) + coalesce(length(q.options::text), 0)), 0)
                + count(q.id) * 96
                + length(e.public_key_pem) + 256)::int AS pkg_bytes,
              a.id AS attempt_id, a.state AS attempt_state,
              a.score_raw, a.score_total
       FROM cbt.exams e
       JOIN org.scope_hierarchy sh
         ON sh.ancestor_id = e.owner_scope_id AND sh.descendant_id = $1::uuid
       JOIN cbt.questions q ON q.exam_id = e.id
       LEFT JOIN cbt.attempts a ON a.exam_id = e.id AND a.user_id = $2::uuid
       WHERE e.status = 'published'
         AND e.closes_at > now() - interval '30 days'
       GROUP BY e.id, a.id
       ORDER BY e.opens_at ASC, e.title ASC`,
      [scopeId, userId],
    );
    return result.rows;
  }

  /**
   * Load one published exam iff visible from `scopeId` (downward inheritance).
   * NEVER selects private_key_pem or question `correct` columns.
   */
  async findVisibleExam(examId: string, scopeId: string): Promise<ExamRow | null> {
    const result = await this.prisma.pool.query<ExamRow>(
      `SELECT e.id, e.title, e.version, e.duration_minutes, e.opens_at,
              e.closes_at, e.key_version, e.public_key_pem
       FROM cbt.exams e
       JOIN org.scope_hierarchy sh
         ON sh.ancestor_id = e.owner_scope_id AND sh.descendant_id = $2::uuid
       WHERE e.id = $1::uuid AND e.status = 'published'`,
      [examId, scopeId],
    );
    return result.rows[0] ?? null;
  }

  /** Package questions — the `correct` column is deliberately not selected. */
  async getPackageQuestions(examId: string): Promise<PackageQuestionRow[]> {
    const result = await this.prisma.pool.query<PackageQuestionRow>(
      `SELECT id, seq, type, text, options
       FROM cbt.questions
       WHERE exam_id = $1::uuid
       ORDER BY seq ASC`,
      [examId],
    );
    return result.rows;
  }

  async findAttemptByExamUser(examId: string, userId: string): Promise<AttemptRow | null> {
    const result = await this.prisma.pool.query<AttemptRow>(
      `SELECT id, exam_id, user_id, state, started_at, deadline_at
       FROM cbt.attempts
       WHERE exam_id = $1::uuid AND user_id = $2::uuid`,
      [examId, userId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Race-safe idempotent start: ON CONFLICT (exam_id, user_id) DO NOTHING —
   * a concurrent double-tap yields one row; the loser re-reads it.
   */
  async insertAttempt(
    examId: string,
    userId: string,
    deadlineAt: Date,
  ): Promise<AttemptRow | null> {
    const result = await this.prisma.pool.query<AttemptRow>(
      `INSERT INTO cbt.attempts (exam_id, user_id, deadline_at)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (exam_id, user_id) DO NOTHING
       RETURNING id, exam_id, user_id, state, started_at, deadline_at`,
      [examId, userId, deadlineAt],
    );
    return result.rows[0] ?? null;
  }

  async getAttemptStatus(attemptId: string): Promise<AttemptStatusRow | null> {
    const result = await this.prisma.pool.query<AttemptStatusRow>(
      `SELECT a.id, a.exam_id, a.user_id, u.scope_id AS user_scope_id,
              a.state, a.submitted_at, a.score_raw, a.score_total,
              (SELECT count(*)::int FROM cbt.answers ans WHERE ans.attempt_id = a.id)
                AS answers_received,
              (SELECT count(*)::int FROM cbt.questions q WHERE q.exam_id = a.exam_id)
                AS total_items
       FROM cbt.attempts a
       JOIN auth.users u ON u.id = a.user_id
       WHERE a.id = $1::uuid`,
      [attemptId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * THE hot path — one transaction per batch, per-event outcomes in input
   * order. LWW merge is the single atomic ON CONFLICT upsert from TECHSTACK
   * §5.3; client_ts is advisory within the server-validated attempt window
   * ([started_at - 2min, deadline_at + 2min]); the server stamps received_at.
   *
   * Returns outcomes plus the attempt ids whose submit merged (the service
   * enqueues grading AFTER commit so the job can never race the transaction).
   */
  async processSyncBatch(
    userId: string,
    events: CbtSyncEvent[],
  ): Promise<{ results: SyncResult[]; submittedAttemptIds: string[] }> {
    const results = new Map<number, SyncResult>();
    const submittedAttemptIds: string[] = [];

    const attemptIds = [...new Set(events.map((e) => e.attemptId))].sort();
    const eventIds = events.map((e) => e.id);

    const client = await this.prisma.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock the (few) attempts touched by this batch — serializes concurrent
      // batches for the same student and makes the submit state check sound.
      // Sorted ids keep lock order deterministic (no deadlocks).
      const attempts = await client.query<AttemptRow>(
        `SELECT id, exam_id, user_id, state, started_at, deadline_at
         FROM cbt.attempts
         WHERE id = ANY($1::uuid[])
         FOR UPDATE`,
        [attemptIds],
      );
      const attemptById = new Map(attempts.rows.map((a) => [a.id, a]));

      // Valid question ids per exam (rejecting unknown ids beats aborting the
      // whole transaction on an FK violation).
      const examIds = [...new Set(attempts.rows.map((a) => a.exam_id))];
      const questions = await client.query<{ id: string; exam_id: string }>(
        `SELECT id, exam_id FROM cbt.questions WHERE exam_id = ANY($1::uuid[])`,
        [examIds],
      );
      const questionExam = new Map(questions.rows.map((q) => [q.id, q.exam_id]));

      // Idempotency: answer events dedupe via answers.event_id; submit events
      // via the cbt.sync_events ledger.
      const knownAnswerEvents = new Set(
        (
          await client.query<{ event_id: string }>(
            `SELECT event_id FROM cbt.answers WHERE event_id = ANY($1::uuid[])`,
            [eventIds],
          )
        ).rows.map((r) => r.event_id),
      );
      const knownLedgerEvents = new Set(
        (
          await client.query<{ event_id: string }>(
            `SELECT event_id FROM cbt.sync_events WHERE event_id = ANY($1::uuid[])`,
            [eventIds],
          )
        ).rows.map((r) => r.event_id),
      );

      const seenInBatch = new Set<string>();

      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        const done = (outcome: SyncResult["outcome"], reason?: string) => {
          results.set(i, reason ? { id: event.id, outcome, reason } : { id: event.id, outcome });
        };

        if (seenInBatch.has(event.id)) {
          done("duplicate", "repeated in this batch");
          continue;
        }
        seenInBatch.add(event.id);

        const attempt = attemptById.get(event.attemptId);
        // Unknown and not-yours collapse into one answer — never confirm
        // another student's attempt id exists.
        if (!attempt || attempt.user_id !== userId) {
          done("rejected", "unknown attempt");
          continue;
        }

        if (event.kind === "answer") {
          if (knownAnswerEvents.has(event.id)) {
            done("duplicate");
            continue;
          }
          if (questionExam.get(event.questionId) !== attempt.exam_id) {
            done("rejected", "unknown question");
            continue;
          }
          // Trailing drips are accepted after submit, but not once grading
          // has begun — the score must be computed over a settled set.
          if (attempt.state !== "in_progress" && attempt.state !== "submitted") {
            done("rejected", "grading has started");
            continue;
          }
          const min = attempt.started_at.getTime() - CLIENT_TS_GRACE_MS;
          const max = attempt.deadline_at.getTime() + CLIENT_TS_GRACE_MS;
          if (event.clientTs < min || event.clientTs > max) {
            done("rejected", "outside exam window");
            continue;
          }

          // LWW-Element-Set merge — ONE atomic, idempotent, order-independent
          // statement (TECHSTACK §5.3). Higher client_ts wins; equal loses
          // (deterministic). No row updated ⇒ an equal-or-newer answer is
          // already stored ⇒ stale.
          const upsert = await client.query(
            `INSERT INTO cbt.answers (attempt_id, question_id, envelope, client_ts, event_id)
             VALUES ($1::uuid, $2::uuid, $3::jsonb, $4, $5::uuid)
             ON CONFLICT (attempt_id, question_id) DO UPDATE
               SET envelope = excluded.envelope,
                   client_ts = excluded.client_ts,
                   received_at = now(),
                   event_id = excluded.event_id
               WHERE excluded.client_ts > cbt.answers.client_ts`,
            [
              event.attemptId,
              event.questionId,
              JSON.stringify(event.payload),
              event.clientTs,
              event.id,
            ],
          );
          done((upsert.rowCount ?? 0) > 0 ? "merged" : "stale");
        } else {
          // submit — idempotent via the ledger AND via attempt state.
          if (knownLedgerEvents.has(event.id) || attempt.state !== "in_progress") {
            done("duplicate");
            continue;
          }
          await client.query(
            `UPDATE cbt.attempts
             SET state = 'submitted', submitted_at = now(),
                 answered_count_claimed = $2
             WHERE id = $1::uuid`,
            [event.attemptId, event.answeredCount],
          );
          attempt.state = "submitted"; // later events in this batch see it
          submittedAttemptIds.push(event.attemptId);
          done("merged");
        }
      }

      // Audit ledger — one multi-row statement for the whole batch. Every
      // outcome is recorded; replays land on ON CONFLICT DO NOTHING.
      const ledgerRows = events
        .map((e, i) => ({ e, r: results.get(i)! }))
        .filter(({ r }) => r.reason !== "repeated in this batch");
      if (ledgerRows.length > 0) {
        await client.query(
          `INSERT INTO cbt.sync_events (event_id, kind, attempt_id, outcome)
           SELECT * FROM unnest($1::uuid[], $2::text[], $3::uuid[], $4::text[])
           ON CONFLICT (event_id) DO NOTHING`,
          [
            ledgerRows.map(({ e }) => e.id),
            ledgerRows.map(({ e }) => e.kind),
            ledgerRows.map(({ e }) => e.attemptId),
            ledgerRows.map(({ r }) => r.outcome),
          ],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    return {
      results: events.map((_, i) => results.get(i)!),
      submittedAttemptIds,
    };
  }
}
