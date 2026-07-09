import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { maskPhone } from "@rl/schemas";
import type {
  ActivationConfirm,
  ActivationRequestResponse,
  JwtClaims,
  LoginResponse,
  TokenPair,
} from "@rl/schemas";
import * as argon2 from "argon2";
import { ConfigService } from "../../platform/config";
import { RedisService } from "../../platform/redis.service";
import {
  OTP_DELIVERY_PORT,
  type OtpDeliveryPort,
} from "../../platform/otp-delivery/otp-delivery.port";
import { AuthRepository } from "./auth.repository";
import { JwksService } from "./jwks.service";

const OTP_TTL_SEC = 600; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const RATE_WINDOW_SEC = 3600; // 1 hour
const RATE_LIMIT_PER_USER = 3;
const RATE_LIMIT_PER_IP = 8;

/** Calm copy — no enumeration detail (unknown email, wrong status, no phone all match). */
const CANNOT_ACTIVATE = "We can't activate this account. Ask your school admin.";
const TOO_MANY_CODES =
  "Too many codes requested — try again in about an hour. Your account is safe.";

/**
 * Stateless auth (TECHSTACK §5.5): RS256 access tokens (15 min) verified via
 * JWKS; rotating refresh tokens (7 days) stored ONLY as sha256 hashes — the
 * single stateful auth artifact. Never a session table.
 *
 * Activation is phone-OTP (Usapp-style): admins create accounts with a phone;
 * the owner proves phone possession with a 6-digit SMS code and sets their
 * own password (auto-login on success).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly jwksService: JwksService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.repo.findUserByEmail(email.toLowerCase());
    // Uniform failure for unknown accounts: never reveal existence.
    const invalid = new UnauthorizedException("Invalid credentials");
    if (!user) {
      // Constant-shape work even for unknown users (timing hardening).
      await argon2
        .verify(
          "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          password,
        )
        .catch(() => false);
      throw invalid;
    }
    // Known-account states get actionable copy (confirmed product decision).
    if (user.status === "pending_activation") {
      throw new ForbiddenException("Set your password first — use Activate account.");
    }
    if (user.status === "disabled") {
      throw new ForbiddenException("This account is disabled — ask your school admin.");
    }
    if (!user.passwordHash) throw invalid;
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

  /* ----------------------- Phone-OTP activation ----------------------- */

  /** PUBLIC. Sends a 6-digit code to the pending account's phone. */
  async requestActivation(email: string, ip: string): Promise<ActivationRequestResponse> {
    // IP limit first — it also throttles enumeration probing.
    await this.enforceRateLimit(`otp:rl:ip:${ip}`, RATE_LIMIT_PER_IP);

    const user = await this.repo.findUserByEmail(email.toLowerCase());
    if (!user || user.status !== "pending_activation" || !user.phone) {
      throw new NotFoundException(CANNOT_ACTIVATE);
    }
    await this.enforceRateLimit(`otp:rl:user:${user.id}`, RATE_LIMIT_PER_USER);

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    // Supersede: only the newest code is ever valid.
    await this.repo.consumeActivationOtps(user.id);
    await this.repo.createActivationOtp({
      userId: user.id,
      phone: user.phone,
      codeHash: this.hashToken(code),
      expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000),
    });
    await this.delivery.send(
      user.phone,
      `Resilient-Learn code: ${code} — use this to set your password. Valid 10 minutes.`,
    );

    const cfg = this.configService.config;
    const response: ActivationRequestResponse = {
      maskedPhone: maskPhone(user.phone),
      expiresInSec: OTP_TTL_SEC,
    };
    // Dev convenience ONLY — never in staging/production.
    if (cfg.NODE_ENV === "development" && cfg.SMS_DRIVER === "mock") {
      response.devCode = code;
    }
    return response;
  }

  /** PUBLIC. Verifies the code, sets the password, activates, auto-logs-in. */
  async confirmActivation(input: ActivationConfirm): Promise<LoginResponse> {
    const user = await this.repo.findUserByEmail(input.email.toLowerCase());
    if (!user || user.status !== "pending_activation" || !user.phone) {
      throw new NotFoundException(CANNOT_ACTIVATE);
    }

    const otp = await this.repo.findLatestActivationOtp(user.id);
    if (!otp) {
      throw new BadRequestException("There's no code for this account — request a new code.");
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await this.repo.consumeOtp(otp.id); // invalidate — a fresh code is required
      throw new HttpException(
        {
          statusCode: 429,
          message: "Too many tries with that code — request a new one. Your account is safe.",
        },
        429,
      );
    }
    if (otp.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("That code has expired. Request a new code.");
    }

    const expected = Buffer.from(otp.codeHash, "hex");
    const presented = createHash("sha256").update(input.code).digest();
    const matches =
      expected.length === presented.length && timingSafeEqual(expected, presented);
    if (!matches) {
      await this.repo.incrementOtpAttempts(otp.id);
      throw new BadRequestException("That code didn't match. Check the SMS and try again.");
    }

    const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    await this.repo.activateUser(user.id, passwordHash, otp.id); // single transaction

    // Auto-login: issue tokens exactly like login.
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
   * Fixed-window Redis INCR+EXPIRE limiter. Fails open on Redis trouble
   * (consistent with the scope cache): correctness never depends on Redis.
   */
  private async enforceRateLimit(key: string, limit: number): Promise<void> {
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, RATE_WINDOW_SEC);
      if (count > limit) {
        throw new HttpException({ statusCode: 429, message: TOO_MANY_CODES }, 429);
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`otp rate-limit check skipped: ${String(err)}`);
    }
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
