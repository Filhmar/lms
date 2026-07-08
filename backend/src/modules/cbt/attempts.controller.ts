import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtAuthGuard } from "../auth";
import type { AuthenticatedUser } from "../auth";
import { CbtService } from "./cbt.service";

@Controller("attempts")
@UseGuards(JwtAuthGuard)
export class AttemptsController {
  constructor(private readonly service: CbtService) {}

  /**
   * GET /api/v1/attempts/:id — own attempt status (admins in scope may view
   * any). The PWA polls this after submit to watch submitted → graded.
   */
  @Get(":id")
  status(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getAttemptStatus(id, user);
  }
}
