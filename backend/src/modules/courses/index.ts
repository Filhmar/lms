/**
 * PUBLIC CONTRACT of the courses module (Phase III headless course player).
 * Other modules may import from "../courses" ONLY (module-public-index rule).
 */
export { CoursesModule } from "./courses.module";
export { CourseProgressSyncService } from "./progress-sync.service";
export type { ProgressSyncResult } from "./courses.repository";
