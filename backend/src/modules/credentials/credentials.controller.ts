import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminRoles, RevokeCredentialRequestSchema } from "@rl/schemas";
import { z } from "zod";
import { createZodDto } from "../../platform/zod-validation.pipe";
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from "../auth";
import type { AuthenticatedUser } from "../auth";
import { CredentialsService } from "./credentials.service";

class RevokeCredentialDto extends createZodDto(RevokeCredentialRequestSchema) {}

/** Local query schema — the shared DTO surface (@rl/schemas) is fixed. */
const AdminListQuerySchema = z.object({
  scopeId: z.uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

/** Phase IV micro-credentials: the holder's wallet + admin oversight. */
@Controller("credentials")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CredentialsController {
  constructor(private readonly service: CredentialsService) {}

  /** GET /api/v1/credentials — the caller's own wallet (any role). */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMine(user);
  }

  /**
   * GET /api/v1/credentials/admin — oversight list over the caller's
   * subtree (declared before :id so "admin" never parses as an id).
   * Admins see holder names — masking is for the PUBLIC portal only.
   */
  @Get("admin")
  @Roles(...AdminRoles)
  adminList(
    @Query() raw: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const parsed = AdminListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Validation failed",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return this.service.adminList(parsed.data, user);
  }

  /** GET /api/v1/credentials/:id — own detail incl. the signed VC + QR URL. */
  @Get(":id")
  detail(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getDetail(id, user);
  }

  /** POST /api/v1/credentials/:id/revoke — admin within subtree; audited. */
  @Post(":id/revoke")
  @HttpCode(200)
  @Roles(...AdminRoles)
  revoke(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: RevokeCredentialDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.revoke(id, body.reason, user);
  }

  /** POST /api/v1/credentials/:id/restore — undo a revocation; audited. */
  @Post(":id/restore")
  @HttpCode(200)
  @Roles(...AdminRoles)
  restore(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.restore(id, user);
  }
}
