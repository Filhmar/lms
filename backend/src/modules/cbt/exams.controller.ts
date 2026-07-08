import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser, JwtAuthGuard } from "../auth";
import type { AuthenticatedUser } from "../auth";
import { CbtService } from "./cbt.service";

/** Exam discovery + offline package + attempt start. All authenticated roles. */
@Controller("exams")
@UseGuards(JwtAuthGuard)
export class ExamsController {
  constructor(private readonly service: CbtService) {}

  /** GET /api/v1/exams — visible exams (downward inheritance) + own attempt. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listExams(user);
  }

  /** GET /api/v1/exams/:id/package — questions (no answers) + public key. */
  @Get(":id/package")
  getPackage(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getPackage(id, user);
  }

  /**
   * POST /api/v1/exams/:id/attempts — start, or return the existing
   * in_progress attempt idempotently. 409 once submitted/graded.
   */
  @Post(":id/attempts")
  @HttpCode(200)
  startAttempt(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.startAttempt(id, user);
  }
}
