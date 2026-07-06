/**
 * PUBLIC CONTRACT of the auth module.
 * Other modules may import from "../auth" ONLY (module-public-index rule).
 */
export { AuthModule } from "./auth.module";
export { JwtAuthGuard } from "./jwt-auth.guard";
export type { AuthenticatedRequest, AuthenticatedUser } from "./jwt-auth.guard";
export { CurrentUser, Roles, RolesGuard } from "./roles";
