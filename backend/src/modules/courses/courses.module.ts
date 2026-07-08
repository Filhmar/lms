import { Module } from "@nestjs/common";
import { AuthModule } from "../auth";
import { CredentialsModule } from "../credentials";
import { CoursesController } from "./courses.controller";
import { CoursesRepository } from "./courses.repository";
import { CoursesService } from "./courses.service";
import { CourseProgressSyncService } from "./progress-sync.service";

@Module({
  // CredentialsModule: completing a course's final page issues a certificate.
  imports: [AuthModule, CredentialsModule],
  controllers: [CoursesController],
  providers: [CoursesService, CoursesRepository, CourseProgressSyncService],
  // Exported for the cbt module, which owns POST /sync/batch and hands the
  // "progress" leg of each batch here.
  exports: [CourseProgressSyncService],
})
export class CoursesModule {}
