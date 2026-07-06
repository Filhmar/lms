import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../auth";
import { ScopeAccessService } from "./scope-access.service";

export const SCOPE_PARAM_KEY = "rl:scopeParam";

/**
 * Declares which route param carries the target scope id for ScopeGuard.
 * (Body-borne targets — e.g. multipart bulk-import — are checked in the
 * service instead, because guards run before interceptors parse multipart.)
 */
export const ScopeParam = (param: string) => SetMetadata(SCOPE_PARAM_KEY, param);

/**
 * Enforces lateral isolation / downward inheritance: the caller's JWT scope
 * must be an ancestor of (or equal to) the target scope. Use AFTER JwtAuthGuard.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const param = this.reflector.getAllAndOverride<string | undefined>(
      SCOPE_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!param) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new UnauthorizedException();

    const targetScopeId = (request.params as Record<string, string>)[param];
    if (!targetScopeId) return true; // Nothing to check on this route.

    const allowed = await this.scopeAccess.canAccess(
      request.user.scopeId,
      targetScopeId,
    );
    if (!allowed) {
      throw new ForbiddenException("Scope not accessible from your position in the hierarchy");
    }
    return true;
  }
}
