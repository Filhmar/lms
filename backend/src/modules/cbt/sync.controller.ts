import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { SyncBatchRequestSchema } from "@rl/schemas";
import { createZodDto } from "../../platform/zod-validation.pipe";
import { CurrentUser, JwtAuthGuard } from "../auth";
import type { AuthenticatedUser } from "../auth";
import { CbtService } from "./cbt.service";

class SyncBatchDto extends createZodDto(SyncBatchRequestSchema) {}

/** The drip-sync hot path. */
@Controller("sync")
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly service: CbtService) {}

  /**
   * POST /api/v1/sync/batch — LWW merge of up to 100 events in one
   * transaction; per-event outcomes (merged|stale|duplicate|rejected) in
   * input order. Always 200: outcome granularity lives in the body so a
   * partially-stale batch never looks like a transport failure to the SW.
   */
  @Post("batch")
  @HttpCode(200)
  batch(@Body() body: SyncBatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.syncBatch(body, user);
  }
}
