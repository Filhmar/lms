import { Injectable } from "@nestjs/common";
import type { ProgressEvent } from "@rl/schemas";
import { PrismaService } from "../../platform/prisma.service";

/* ------------------------------ row shapes ------------------------------ */

export interface CourseListRow {
  id: string;
  title: string;
  subject: string;
  version: number;
  chapters: number;
  total_pages: number;
  completed_pages: number;
  manifest_bytes: number;
}

export interface CourseRow {
  id: string;
  title: string;
  subject: string;
  version: number;
}

export interface ManifestPageRow {
  chapter_id: string;
  chapter_seq: number;
  chapter_title: string;
  id: string | null;
  seq: number | null;
  type: string | null;
  title: string | null;
  body: string | null;
  video_asset_key: string | null;
  /** pg returns BIGINT as string. */
  video_size_bytes: string | null;
  video_duration_label: string | null;
  exam_id: string | null;
}

export interface VideoAssetRow {
  video_asset_key: string;
  /** pg returns BIGINT as string. */
  video_size_bytes: string;
}

export interface ProgressSyncResult {
  id: string;
  outcome: "merged" | "stale" | "duplicate" | "rejected";
  reason?: string;
}

/** Progress clientTs sanity: reject only the absurd future (clock skew grace
 *  5 min). No lower bound — a page read weeks ago offline is still valid. */
const CLIENT_TS_FUTURE_GRACE_MS = 5 * 60 * 1000;

/**
 * Courses data access. Hot paths are raw SQL on the shared pg.Pool with
 * fully-qualified table names (courses.* / org.*) — same visibility join as
 * cbt: the course's owner scope must be an ANCESTOR-or-self of the caller's
 * scope (downward inheritance; lateral isolation falls out for free).
 */
@Injectable()
export class CoursesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Published courses visible from `scopeId`, with per-course chapter/page
   * counts, the caller's completed-page count, and a manifest size estimate
   * (title+body text + per-page/per-chapter JSON overhead).
   */
  async listVisibleCourses(scopeId: string, userId: string): Promise<CourseListRow[]> {
    const result = await this.prisma.pool.query<CourseListRow>(
      `SELECT c.id, c.title, c.subject, c.version,
              count(DISTINCT ch.id)::int AS chapters,
              count(p.id)::int AS total_pages,
              (SELECT count(*)::int FROM courses.progress pr
               WHERE pr.user_id = $2::uuid AND pr.course_id = c.id) AS completed_pages,
              (coalesce(sum(length(p.title) + coalesce(length(p.body), 0)), 0)
                + count(p.id) * 96
                + count(DISTINCT ch.id) * 64 + 256)::int AS manifest_bytes
       FROM courses.courses c
       JOIN org.scope_hierarchy sh
         ON sh.ancestor_id = c.owner_scope_id AND sh.descendant_id = $1::uuid
       LEFT JOIN courses.chapters ch ON ch.course_id = c.id
       LEFT JOIN courses.pages p ON p.chapter_id = ch.id
       WHERE c.status = 'published'
       GROUP BY c.id
       ORDER BY c.subject ASC, c.title ASC`,
      [scopeId, userId],
    );
    return result.rows;
  }

  /** Load one published course iff visible from `scopeId`. */
  async findVisibleCourse(courseId: string, scopeId: string): Promise<CourseRow | null> {
    const result = await this.prisma.pool.query<CourseRow>(
      `SELECT c.id, c.title, c.subject, c.version
       FROM courses.courses c
       JOIN org.scope_hierarchy sh
         ON sh.ancestor_id = c.owner_scope_id AND sh.descendant_id = $2::uuid
       WHERE c.id = $1::uuid AND c.status = 'published'`,
      [courseId, scopeId],
    );
    return result.rows[0] ?? null;
  }

  /** Chapters + pages ordered by seq (chapters kept even while empty). */
  async getManifestRows(courseId: string): Promise<ManifestPageRow[]> {
    const result = await this.prisma.pool.query<ManifestPageRow>(
      `SELECT ch.id AS chapter_id, ch.seq AS chapter_seq, ch.title AS chapter_title,
              p.id, p.seq, p.type, p.title, p.body,
              p.video_asset_key, p.video_size_bytes, p.video_duration_label,
              p.exam_id
       FROM courses.chapters ch
       LEFT JOIN courses.pages p ON p.chapter_id = ch.id
       WHERE ch.course_id = $1::uuid
       ORDER BY ch.seq ASC, p.seq ASC`,
      [courseId],
    );
    return result.rows;
  }

  /**
   * Resolve an asset key iff it is referenced by a video page of a published
   * course visible from `scopeId` — arbitrary storage keys can never be
   * fetched through the assets endpoint.
   */
  async findVisibleVideoAsset(
    courseId: string,
    assetKey: string,
    scopeId: string,
  ): Promise<VideoAssetRow | null> {
    const result = await this.prisma.pool.query<VideoAssetRow>(
      `SELECT p.video_asset_key, p.video_size_bytes
       FROM courses.pages p
       JOIN courses.chapters ch ON ch.id = p.chapter_id
       JOIN courses.courses c ON c.id = ch.course_id
       JOIN org.scope_hierarchy sh
         ON sh.ancestor_id = c.owner_scope_id AND sh.descendant_id = $3::uuid
       WHERE ch.course_id = $1::uuid AND p.type = 'video'
         AND p.video_asset_key = $2 AND c.status = 'published'`,
      [courseId, assetKey, scopeId],
    );
    return result.rows[0] ?? null;
  }

  /** The caller's completed page ids for one course (page order). */
  async getCompletedPageIds(courseId: string, userId: string): Promise<string[]> {
    const result = await this.prisma.pool.query<{ page_id: string }>(
      `SELECT pr.page_id
       FROM courses.progress pr
       JOIN courses.pages p ON p.id = pr.page_id
       JOIN courses.chapters ch ON ch.id = p.chapter_id
       WHERE pr.user_id = $1::uuid AND pr.course_id = $2::uuid
       ORDER BY ch.seq ASC, p.seq ASC`,
      [userId, courseId],
    );
    return result.rows.map((r) => r.page_id);
  }

  /**
   * Progress leg of POST /sync/batch — one transaction per sub-batch,
   * outcomes in input order. Mirrors cbt.answers: LWW merge is ONE atomic
   * ON CONFLICT upsert keyed (user_id, page_id); higher client_ts wins,
   * equal loses (deterministic); event_id is the idempotency key.
   */
  async processProgressEvents(
    userId: string,
    scopeId: string,
    events: ProgressEvent[],
  ): Promise<ProgressSyncResult[]> {
    const results: ProgressSyncResult[] = [];

    const courseIds = [...new Set(events.map((e) => e.courseId))];
    const pageIds = [...new Set(events.map((e) => e.pageId))];
    const eventIds = events.map((e) => e.id);

    const client = await this.prisma.pool.connect();
    try {
      await client.query("BEGIN");

      // Visibility: published + ancestor-or-self of the caller's scope.
      // Invisible and nonexistent collapse into one answer — never confirm
      // a foreign course id exists.
      const visible = new Set(
        (
          await client.query<{ id: string }>(
            `SELECT c.id
             FROM courses.courses c
             JOIN org.scope_hierarchy sh
               ON sh.ancestor_id = c.owner_scope_id AND sh.descendant_id = $2::uuid
             WHERE c.id = ANY($1::uuid[]) AND c.status = 'published'`,
            [courseIds, scopeId],
          )
        ).rows.map((r) => r.id),
      );

      // page → owning course (rejecting unknown/mismatched pages beats
      // aborting the whole transaction on an FK violation).
      const pageCourse = new Map(
        (
          await client.query<{ id: string; course_id: string }>(
            `SELECT p.id, ch.course_id
             FROM courses.pages p
             JOIN courses.chapters ch ON ch.id = p.chapter_id
             WHERE p.id = ANY($1::uuid[])`,
            [pageIds],
          )
        ).rows.map((r) => [r.id, r.course_id]),
      );

      // Idempotency: replayed event ids dedupe via progress.event_id (same
      // pattern as answers.event_id; an overwritten event id replayed later
      // simply loses the LWW upsert → stale).
      const knownEvents = new Set(
        (
          await client.query<{ event_id: string }>(
            `SELECT event_id FROM courses.progress WHERE event_id = ANY($1::uuid[])`,
            [eventIds],
          )
        ).rows.map((r) => r.event_id),
      );

      const seenInBatch = new Set<string>();
      const maxClientTs = Date.now() + CLIENT_TS_FUTURE_GRACE_MS;

      for (const event of events) {
        const done = (outcome: ProgressSyncResult["outcome"], reason?: string) => {
          results.push(reason ? { id: event.id, outcome, reason } : { id: event.id, outcome });
        };

        if (seenInBatch.has(event.id)) {
          done("duplicate", "repeated in this batch");
          continue;
        }
        seenInBatch.add(event.id);

        if (knownEvents.has(event.id)) {
          done("duplicate");
          continue;
        }
        if (!visible.has(event.courseId)) {
          done("rejected", "unknown course");
          continue;
        }
        if (pageCourse.get(event.pageId) !== event.courseId) {
          done("rejected", "unknown page");
          continue;
        }
        // No lower bound — reading may genuinely be old (offline for weeks);
        // only an absurdly-future stamp is rejected.
        if (event.clientTs > maxClientTs) {
          done("rejected", "timestamp in the future");
          continue;
        }

        const upsert = await client.query(
          `INSERT INTO courses.progress (user_id, course_id, page_id, client_ts, event_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid)
           ON CONFLICT (user_id, page_id) DO UPDATE
             SET client_ts = excluded.client_ts,
                 received_at = now(),
                 event_id = excluded.event_id
             WHERE excluded.client_ts > courses.progress.client_ts`,
          [userId, event.courseId, event.pageId, event.clientTs, event.id],
        );
        done((upsert.rowCount ?? 0) > 0 ? "merged" : "stale");
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    return results;
  }
}
