import { Injectable } from "@nestjs/common";
import type { ProgressEvent } from "@rl/schemas";
import { CoursesRepository, type ProgressSyncResult } from "./courses.repository";

/**
 * The courses leg of POST /api/v1/sync/batch. The cbt module (which owns the
 * endpoint) partitions the batch by event kind and hands "progress" events
 * here through this public seam — answer/submit behavior is untouched.
 */
@Injectable()
export class CourseProgressSyncService {
  constructor(private readonly repo: CoursesRepository) {}

  /** LWW merge of progress events; outcomes in input order. */
  process(
    userId: string,
    scopeId: string,
    events: ProgressEvent[],
  ): Promise<ProgressSyncResult[]> {
    return this.repo.processProgressEvents(userId, scopeId, events);
  }
}
