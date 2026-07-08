import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { AdminRoles } from "@rl/schemas";
import { JwtAuthGuard, Roles, RolesGuard } from "../auth";
import { ScopeGuard, ScopeParam } from "../org-hierarchy";
import { UsersService } from "./users.service";

/**
 * GET /api/v1/scopes/:id/stats — subtree user counts for admin dashboards.
 * Lives in the users module (it aggregates auth.users); shares the "scopes"
 * route prefix with org-hierarchy's subtree/breadcrumb routes.
 */
@Controller("scopes")
@UseGuards(JwtAuthGuard, RolesGuard, ScopeGuard)
export class ScopeStatsController {
  constructor(private readonly service: UsersService) {}

  @Get(":id/stats")
  @Roles(...AdminRoles)
  @ScopeParam("id")
  stats(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.scopeStats(id);
  }
}
