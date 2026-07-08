import Fastify from "fastify";
import Redis from "ioredis";
import { Pool } from "pg";
import type { VerifyResponse } from "@rl/schemas";
import { verifyVc } from "./vc-verify";

/**
 * @rl/verify — the Phase IV standalone credential verification portal
 * (TECHSTACK §5.5): a separate READ-ONLY deployable so public verification
 * traffic can never touch the LMS. It reads exactly two tables —
 * creds.verify_read (the denormalized read model, no joins against users/
 * courses) and creds.issuer_keys (public halves only) — checks the Ed25519
 * eddsa-jcs-2022 proof at read time, and answers with masked names only.
 *
 * Env: DATABASE_URL (required), VERIFY_PORT (default 3300), REDIS_URL
 * (optional — rate limiting falls back to an in-memory fixed window, fine
 * for a single replica; use Redis when scaling out). Rate limit: 30/min/IP,
 * matching the in-monolith GET /api/v1/verify/:code.
 */

const RATE_WINDOW_SEC = 60;
const RATE_LIMIT_PER_IP = 30;
const TOO_MANY = "Too many verification requests — try again in a minute.";

const NOT_FOUND: VerifyResponse = {
  status: "not_found",
  maskedName: null,
  title: null,
  issuerLine: null,
  issuedAt: null,
  controlNo: null,
  signatureValid: null,
};

/* ----------------------------- rate limiting ----------------------------- */

interface RateLimiter {
  /** true = allowed, false = over the limit. Fails open on backend trouble. */
  hit(ip: string): Promise<boolean>;
}

class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async hit(ip: string): Promise<boolean> {
    const now = Date.now();
    // Opportunistic prune so an IP scan can't grow the map unbounded.
    if (this.windows.size > 10_000) {
      for (const [key, win] of this.windows) {
        if (win.resetAt <= now) this.windows.delete(key);
      }
    }
    const win = this.windows.get(ip);
    if (!win || win.resetAt <= now) {
      this.windows.set(ip, { count: 1, resetAt: now + RATE_WINDOW_SEC * 1000 });
      return true;
    }
    win.count += 1;
    return win.count <= RATE_LIMIT_PER_IP;
  }
}

class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async hit(ip: string): Promise<boolean> {
    try {
      const key = `verify:rl:ip:${ip}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, RATE_WINDOW_SEC);
      return count <= RATE_LIMIT_PER_IP;
    } catch {
      return true; // fail open — verification must stay available
    }
  }
}

/* --------------------------------- app --------------------------------- */

/** Codes are case-insensitive; tolerate a missing dash from hand-typing. */
function normalizeCode(raw: string): string {
  const cleaned = raw.trim().toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  }
  return cleaned;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set — refusing to start half-alive.");
    process.exit(1);
  }
  const port = Number(process.env.VERIFY_PORT ?? 3300);

  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  // Defense in depth: this service is read-only BY CONSTRUCTION; make every
  // connection read-only at the session level too.
  pool.on("connect", (client) => {
    void client.query("SET default_transaction_read_only = on");
  });

  const redisUrl = process.env.REDIS_URL;
  const redis = redisUrl
    ? new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 })
    : null;
  redis?.on("error", (err) => console.warn(`redis: ${err.message}`));
  const limiter: RateLimiter = redis
    ? new RedisRateLimiter(redis)
    : new MemoryRateLimiter();

  const publicKeys = new Map<number, string>();
  async function publicKeyPem(version: number): Promise<string | null> {
    const cached = publicKeys.get(version);
    if (cached) return cached;
    const result = await pool.query<{ public_key_pem: string }>(
      "SELECT public_key_pem FROM creds.issuer_keys WHERE version = $1",
      [version],
    );
    const pem = result.rows[0]?.public_key_pem ?? null;
    if (pem) publicKeys.set(version, pem);
    return pem;
  }

  const app = Fastify({
    logger: { level: process.env.NODE_ENV === "production" ? "info" : "debug" },
    // Behind the portal's CDN/LB the client address arrives in XFF.
    trustProxy: true,
  });

  app.get("/healthz", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.status(503).send({ status: "degraded" });
    }
  });

  app.get<{ Params: { code: string } }>("/v1/verify/:code", async (req, reply) => {
    if (!(await limiter.hit(req.ip))) {
      return reply.status(429).send({ statusCode: 429, message: TOO_MANY });
    }

    const result = await pool.query<{
      status: string;
      masked_name: string;
      title: string;
      issuer_line: string;
      issued_at: Date;
      control_no: string;
      vc: Record<string, unknown>;
      key_version: number;
    }>(
      `SELECT status, masked_name, title, issuer_line, issued_at,
              control_no, vc, key_version
       FROM creds.verify_read
       WHERE verify_code = $1`,
      [normalizeCode(req.params.code)],
    );
    const row = result.rows[0];
    if (!row) return NOT_FOUND; // same shape for unknown + malformed codes

    const pem = await publicKeyPem(row.key_version);
    const response: VerifyResponse = {
      // Revoked keeps the masked details (design: show what was revoked).
      status: row.status === "revoked" ? "revoked" : "verified",
      maskedName: row.masked_name,
      title: row.title,
      issuerLine: row.issuer_line,
      issuedAt: row.issued_at.toISOString(),
      controlNo: row.control_no,
      signatureValid: pem !== null && verifyVc(row.vc, pem),
    };
    return response;
  });

  const close = async () => {
    await app.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    if (redis) await redis.quit().catch(() => redis.disconnect());
    process.exit(0);
  };
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());

  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(
    `verify portal listening on :${port} (read-only; rate limit ${RATE_LIMIT_PER_IP}/min/IP via ${redis ? "redis" : "memory"})`,
  );
}

void main();
