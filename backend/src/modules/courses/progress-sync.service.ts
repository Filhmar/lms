import { Injectable, Logger } from "@nestjs/common";
import type { ProgressEvent } from "@rl/schemas";
import { CredentialIssuer } from "../credentials";
import { CoursesRepository, type ProgressSyncResult } from "./courses.repository";

/**
 * The courses leg of POST /api/v1/sync/batch. The cbt module (which owns the
 * endpoint) partitions the batch by event kind and hands "progress" events
 * here through this public seam — answer/submit behavior is untouched.
 */
@Injectable()
export class CourseProgressSyncService {
  private readonly logger = new Logger(CourseProgressSyncService.name);

  constructor(
    private readonly repo: CoursesRepository,
    private readonly issuer: CredentialIssuer,
  ) {}

  /** LWW merge of progress events; outcomes in input order. */
  async process(
    userId: string,
    scopeId: string,
    events: ProgressEvent[],
  ): Promise<ProgressSyncResult[]> {
    const results = await this.repo.processProgressEvents(userId, scopeId, events);

    // Phase IV: when merged progress may have completed a course, offer it
    // to the issuer (cheap existence check + full-completion count there;
    // race-safe via the partial unique index). Progress is already committed
    // — an issuance hiccup must never fail the sync response, so log-only.
    const mergedIds = new Set(
      results.filter((r) => r.outcome === "merged").map((r) => r.id),
    );
    const courseIds = new Set(
      events.filter((e) => mergedIds.has(e.id)).map((e) => e.courseId),
    );
    for (const courseId of courseIds) {
      try {
        await this.issuer.maybeIssueCourseCertificate(userId, courseId);
      } catch (err) {
        this.logger.error(
          `certificate issuance check failed for user ${userId} course ${courseId}: ${String(err)}`,
        );
      }
    }

    return results;
  }
}
