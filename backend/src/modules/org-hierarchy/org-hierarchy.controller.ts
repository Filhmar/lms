import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CreateScopeRequestSchema } from "@rl/schemas";
import { createZodDto } from "../../platform/zod-validation.pipe";
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from "../auth";
import type { AuthenticatedUser } from "../auth";
import { OrgHierarchyService } from "./org-hierarchy.service";
import { ScopeGuard, ScopeParam } from "./scope.guard";

class CreateScopeDto extends createZodDto(CreateScopeRequestSchema) {}

@Controller("scopes")
@UseGuards(JwtAuthGuard, RolesGuard, ScopeGuard)
export class OrgHierarchyController {
  constructor(private readonly service: OrgHierarchyService) {}

  /** POST /api/v1/scopes — admin-only; parent-scope authorization in service. */
  @Post()
  @HttpCode(201)
  @Roles("central_admin", "region_admin", "division_admin", "district_admin")
  createScope(@Body() body: CreateScopeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createScope(body, user);
  }

  /** GET /api/v1/scopes/:id/subtree — single index-scan join; lateral isolation via ScopeGuard. */
  @Get(":id/subtree")
  @ScopeParam("id")
  getSubtree(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getSubtree(id, user);
  }

  /** GET /api/v1/scopes/:id/breadcrumb — ancestors ordered by depth desc. */
  @Get(":id/breadcrumb")
  @ScopeParam("id")
  getBreadcrumb(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getBreadcrumb(id, user);
  }
}
