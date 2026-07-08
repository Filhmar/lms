import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CourseListItem,
  CourseManifest,
  CoursePage,
  CourseProgressResponse,
  PageType,
} from "@rl/schemas";
import type { AuthenticatedUser } from "../auth";
import { CoursesRepository, type CourseRow, type ManifestPageRow } from "./courses.repository";

/** Calm copy — invisible and nonexistent are both a plain 404. */
const COURSE_NOT_FOUND = "Course not found";
const VIDEO_NOT_FOUND = "Video not found";

/** Only plain basenames are ever valid asset keys (defense in depth — the
 *  local-fs driver also refuses keys that escape the storage root). */
const ASSET_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface AssetDescriptor {
  /** ObjectStorage key (namespaced under the course). */
  storageKey: string;
  sizeBytes: number;
  contentType: string;
}

@Injectable()
export class CoursesService {
  constructor(private readonly repo: CoursesRepository) {}

  /** GET /courses — visible published courses + the caller's progress counts. */
  async listCourses(actor: AuthenticatedUser): Promise<CourseListItem[]> {
    const rows = await this.repo.listVisibleCourses(actor.scopeId, actor.sub);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject,
      version: row.version,
      chapters: row.chapters,
      totalPages: row.total_pages,
      completedPages: row.completed_pages,
      manifestBytes: row.manifest_bytes,
    }));
  }

  /**
   * GET /courses/:id/manifest — headless delivery: chapters → pages ordered
   * by seq; video pages expose an authenticated assetPath (never a raw
   * storage location); assessment pages carry the embedded exam id.
   */
  async getManifest(courseId: string, actor: AuthenticatedUser): Promise<CourseManifest> {
    const course = await this.loadVisibleCourse(courseId, actor);
    const rows = await this.repo.getManifestRows(courseId);

    const chapters = new Map<
      string,
      { id: string; seq: number; title: string; pages: CoursePage[] }
    >();
    for (const row of rows) {
      let chapter = chapters.get(row.chapter_id);
      if (!chapter) {
        chapter = {
          id: row.chapter_id,
          seq: row.chapter_seq,
          title: row.chapter_title,
          pages: [],
        };
        chapters.set(row.chapter_id, chapter);
      }
      if (row.id !== null) chapter.pages.push(toManifestPage(courseId, row));
    }

    return {
      courseId: course.id,
      version: course.version,
      title: course.title,
      subject: course.subject,
      chapters: [...chapters.values()],
    };
  }

  /** GET /courses/:id/progress — the caller's completed pages for one course. */
  async getProgress(
    courseId: string,
    actor: AuthenticatedUser,
  ): Promise<CourseProgressResponse> {
    const course = await this.loadVisibleCourse(courseId, actor);
    const completedPageIds = await this.repo.getCompletedPageIds(course.id, actor.sub);
    return { courseId: course.id, completedPageIds };
  }

  /**
   * GET /courses/:id/assets/:key — resolve a video asset iff the key is
   * referenced by a video page of a course visible to the caller. The
   * controller streams it from the ObjectStorage port.
   */
  async resolveAsset(
    courseId: string,
    assetKey: string,
    actor: AuthenticatedUser,
  ): Promise<AssetDescriptor> {
    if (!ASSET_KEY_RE.test(assetKey)) throw new NotFoundException(VIDEO_NOT_FOUND);
    const row = await this.repo.findVisibleVideoAsset(courseId, assetKey, actor.scopeId);
    if (!row) throw new NotFoundException(VIDEO_NOT_FOUND);
    return {
      storageKey: `courses/${courseId}/${row.video_asset_key}`,
      sizeBytes: Number(row.video_size_bytes),
      contentType: contentTypeFor(row.video_asset_key),
    };
  }

  private async loadVisibleCourse(
    courseId: string,
    actor: AuthenticatedUser,
  ): Promise<CourseRow> {
    const course = await this.repo.findVisibleCourse(courseId, actor.scopeId);
    if (!course) throw new NotFoundException(COURSE_NOT_FOUND);
    return course;
  }
}

function toManifestPage(courseId: string, row: ManifestPageRow): CoursePage {
  const type = row.type as PageType;
  return {
    id: row.id!,
    seq: row.seq!,
    type,
    title: row.title ?? "",
    body: type === "text_content" ? row.body : null,
    video:
      type === "video" && row.video_asset_key !== null
        ? {
            assetPath: `/api/v1/courses/${courseId}/assets/${row.video_asset_key}`,
            sizeBytes: Number(row.video_size_bytes ?? 0),
            durationLabel: row.video_duration_label ?? "",
          }
        : null,
    examId: type === "assessment_embed" ? row.exam_id : null,
  };
}

function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}
