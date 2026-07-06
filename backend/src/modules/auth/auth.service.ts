import { createHash, randomBytes } from "node:crypto";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { JwtClaims, LoginResponse, TokenPair } from "@rl/schemas";
import * as argon2 from "argon2";
import { ConfigService } from "../../platform/config";
import { AuthRepository } from "./auth.repository";
import { JwksService } from "./jwks.service";

/**
 * Stateless auth (TECHSTACK §5.5): RS256 access tokens (15 min) verified via
 * JWKS; rotating refresh tokens (7 days) stored ONLY as sha256 hashes — the
 * single stateful auth artifact. Never a session table.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly jwksService: JwksService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.repo.findUserByEmail(email.toLowerCase());
    // Uniform failure: never reveal whether the account exists/state.
    const invalid = new UnauthorizedException("Invalid credentials");
    if (!user || !user.passwordHash || user.status !== "active") {
      // Constant-shape work even for unknown users (timing hardening).
      await argon2
        .verify(
          "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          password,
        )
        .catch(() => false);
      throw invalid;
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw invalid;

    const pair = await this.issueTokenPair(user.id, user.role, user.scopeId);
    return {
      ...pair,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        scopeId: user.scopeId,
      },
    };
  }

  /**
   * Rotation with reuse detection: a presented token that was already
   * revoked/replaced means theft or replay — revoke the whole family.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.repo.findRefreshTokenByHash(tokenHash);
    if (!stored) throw new UnauthorizedException("Invalid refresh token");

    if (stored.revokedAt) {
      const revoked = await this.repo.revokeAllUserTokens(stored.userId);
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId} — revoked ${revoked} active token(s)`,
      );
      throw new UnauthorizedException("Refresh token reuse detected");
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    const user = await this.repo.findUserById(stored.userId);
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const pair = await this.issueTokenPair(user.id, user.role, user.scopeId);
    // Link old → new for the audit chain, then the old token is dead.
    const newHash = this.hashToken(pair.refreshToken);
    const newRow = await this.repo.findRefreshTokenByHash(newHash);
    await this.repo.revokeToken(stored.id, newRow?.id);
    return pair;
  }

  async logout(refreshToken: string): Promise<void> {
    const stored = await this.repo.findRefreshTokenByHash(this.hashToken(refreshToken));
    if (stored && !stored.revokedAt) {
      await this.repo.revokeToken(stored.id);
    }
    // Idempotent: unknown/already-revoked tokens return the same 204.
  }

  private async issueTokenPair(
    userId: string,
    role: string,
    scopeId: string,
  ): Promise<TokenPair> {
    const cfg = this.configService.config;
    const claims: JwtClaims = { sub: userId, role: role as JwtClaims["role"], scopeId };
    const accessToken = await this.jwtService.signAsync(
      { role: claims.role, scopeId: claims.scopeId },
      {
        subject: userId,
        algorithm: "RS256",
        expiresIn: cfg.ACCESS_TOKEN_TTL_SEC,
        keyid: this.jwksService.kid,
      },
    );

    // Opaque 256-bit refresh token; only its sha256 hex ever touches the DB.
    const refreshToken = randomBytes(32).toString("base64url");
    await this.repo.createRefreshToken({
      userId,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + cfg.REFRESH_TOKEN_TTL_SEC * 1000),
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
