import { Controller, Get, HttpException, Logger, Param, Req } from "@nestjs/common";
import type { Request } from "express";
import { RedisService } from "../../platform/redis.service";
import { CredentialsService } from "./credentials.service";

const RATE_WINDOW_SEC = 60;
const RATE_LIMIT_PER_IP = 30;

/**
 * PUBLIC credential verification — no auth, rate-limited 30/min/IP.
 * Also served (identically) by the standalone verify deployable, which
 * reads only creds.verify_read + creds.issuer_keys; this in-monolith copy
 * keeps the single-origin dev/demo topology working without it.
 */
@Controller("verify")
export class VerifyController {
  private readonly logger = new Logger(VerifyController.name);

  constructor(
    private readonly service: CredentialsService,
    private readonly redis: RedisService,
  ) {}

  /** GET /api/v1/verify/:code → VerifyResponse (verified|revoked|not_found). */
  @Get(":code")
  async verify(@Param("code") code: string, @Req() req: Request) {
    await this.enforceRateLimit(req.ip ?? "unknown");
    return this.service.publicVerify(code);
  }

  /** Fixed-window INCR+EXPIRE limiter (same shape as the OTP limiter).
   *  Fails open on Redis trouble — verification must stay available. */
  private async enforceRateLimit(ip: string): Promise<void> {
    const key = `creds:verify:rl:ip:${ip}`;
    try {
      const count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, RATE_WINDOW_SEC);
      if (count > RATE_LIMIT_PER_IP) {
        throw new HttpException(
          "Too many verification requests — try again in a minute.",
          429,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`verify rate limit unavailable: ${String(err)}`);
    }
  }
}
