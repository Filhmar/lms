import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  AdminRoles,
  CreateUserRequestSchema,
  ListUsersQuerySchema,
  UpdateUserRequestSchema,
} from "@rl/schemas";
import type { ListUsersQuery } from "@rl/schemas";
import { createZodDto } from "../../platform/zod-validation.pipe";
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from "../auth";
import type { AuthenticatedUser } from "../auth";
import { UsersService } from "./users.service";

class CreateUserDto extends createZodDto(CreateUserRequestSchema) {}
class UpdateUserDto extends createZodDto(UpdateUserRequestSchema) {}

/**
 * Query strings arrive as strings, and z.coerce.boolean() treats "false" as
 * true (Boolean("false")); normalize the flag to a real boolean BEFORE the
 * shared (fixed) schema parses it, so ?includeDescendants=false works.
 */
function parseListQuery(raw: Record<string, unknown>): ListUsersQuery {
  const input = { ...raw };
  if (typeof input.includeDescendants === "string") {
    input.includeDescendants = !["false", "0", ""].includes(
      input.includeDescendants.toLowerCase(),
    );
  }
  const result = ListUsersQuerySchema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      statusCode: 400,
      message: "Validation failed",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  /** GET /api/v1/users/me — any authenticated role; own record + breadcrumb. */
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.service.me(user);
  }

  /** GET /api/v1/users — admin listing scoped to the caller's subtree. */
  @Get()
  @Roles(...AdminRoles)
  list(@Query() raw: Record<string, unknown>, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(parseListQuery(raw), user);
  }

  /** POST /api/v1/users — admin create (pending_activation, no password). */
  @Post()
  @HttpCode(201)
  @Roles(...AdminRoles)
  create(@Body() body: CreateUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(body, user);
  }

  /** PATCH /api/v1/users/:id — admin update within the caller's subtree. */
  @Patch(":id")
  @Roles(...AdminRoles)
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, body, user);
  }
}
