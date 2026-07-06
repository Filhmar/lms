import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminRoles } from "@rl/schemas";
import { z } from "zod";
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from "../auth";
import type { AuthenticatedUser } from "../auth";
import { ProvisioningService } from "./provisioning.service";

const targetScopeIdSchema = z.uuid();

@Controller("provisioning")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...AdminRoles)
export class ProvisioningController {
  constructor(private readonly service: ProvisioningService) {}

  /**
   * POST /api/v1/provisioning/bulk-import (multipart: file + targetScopeId)
   * → 202 Accepted immediately; processing is always asynchronous.
   * NOTE: the scope check happens in the service (multipart fields are not
   * parsed yet when guards run), via the closure table.
   */
  @Post("bulk-import")
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  bulkImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("targetScopeId") targetScopeId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Missing multipart field: file");
    const parsedScope = targetScopeIdSchema.safeParse(targetScopeId);
    if (!parsedScope.success) {
      throw new BadRequestException("targetScopeId must be a UUID");
    }
    return this.service.acceptBulkImport(file, parsedScope.data, user);
  }

  /** GET /api/v1/provisioning/job/:jobId — job state from prov.jobs (Postgres is truth). */
  @Get("job/:jobId")
  getJobStatus(
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getJobStatus(jobId, user);
  }
}
