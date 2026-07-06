import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { JwtClaimsSchema, type JwtClaims } from "@rl/schemas";
import type { Request } from "express";
import { ConfigService } from "../../platform/config";

export type AuthenticatedUser = JwtClaims;

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/** Verifies the RS256 bearer token — a pure signature check, no DB hit. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = header.slice("Bearer ".length).trim();

    let payload: unknown;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        publicKey: this.configService.config.jwtPublicKeyPem,
        algorithms: ["RS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const claims = JwtClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new UnauthorizedException("Malformed token claims");
    }
    request.user = claims.data;
    return true;
  }
}
