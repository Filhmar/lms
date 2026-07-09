import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { z } from "zod";

/**
 * Zod-validated environment (fail-fast at boot, per the blueprint pattern).
 * A tiny .env loader is included for dev ergonomics (no dotenv dependency);
 * real environments inject env vars directly.
 */

/** Treats empty-string env vars (compose `${VAR:-}` passthrough) as unset. */
const optionalEnv = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3200),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    JWT_PRIVATE_KEY_PATH: z.string().min(1),
    JWT_PUBLIC_KEY_PATH: z.string().min(1),
    STORAGE_DIR: z.string().min(1),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 min
    REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(604800), // 7 days
    /** prom-client standalone server; 0 disables (host dev default). */
    METRICS_PORT: z.coerce.number().int().min(0).default(0),
    /**
     * Public base URL of the credential verify portal — baked into every
     * issued VC (issuer id, verificationMethod, QR verify URL). The dev
     * default rides the frontend origin; real deploys point at the portal
     * domain (e.g. https://verify.deped.gov.ph).
     */
    VERIFY_PUBLIC_BASE: optionalEnv(z.string().min(1).optional())
      .transform((v) => (v ?? "http://localhost:3000/verify").replace(/\/+$/, "")),
    /** SMS driver for phone-OTP activation: mock (logs the code) or http gateway. */
    SMS_DRIVER: z.enum(["mock", "http"]).default("mock"),
    SMS_HTTP_URL: optionalEnv(z.url().optional()),
    SMS_HTTP_API_KEY: optionalEnv(z.string().min(1).optional()),
    /** Usapp tenant API — base origin, raw API key, and per-request timeout. */
    USAPP_BASE_URL: optionalEnv(z.url().optional()),
    USAPP_API_KEY: optionalEnv(z.string().min(1).optional()),
    USAPP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  })
  .superRefine((env, ctx) => {
    if (env.SMS_DRIVER === "http") {
      if (!env.SMS_HTTP_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["SMS_HTTP_URL"],
          message: "required when SMS_DRIVER=http",
        });
      }
      if (!env.SMS_HTTP_API_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["SMS_HTTP_API_KEY"],
          message: "required when SMS_DRIVER=http",
        });
      }
    }
  });

export interface AppConfig extends z.infer<typeof EnvSchema> {
  /** PEM contents, read once at boot (fail-fast if missing). */
  jwtPrivateKeyPem: string;
  jwtPublicKeyPem: string;
  /** Absolute storage root for the local-fs ObjectStorage driver. */
  storageDir: string;
}

/** Minimal KEY=VALUE .env parser; never overrides already-set process env. */
export function loadDotEnv(baseDir: string): void {
  const envPath = join(baseDir, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  // The backend package root (cwd when run via pnpm scripts).
  const baseDir = process.cwd();
  loadDotEnv(baseDir);

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Fail fast: a misconfigured process must never come up half-alive.
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(baseDir, p));

  const privateKeyPath = abs(env.JWT_PRIVATE_KEY_PATH);
  const publicKeyPath = abs(env.JWT_PUBLIC_KEY_PATH);
  for (const p of [privateKeyPath, publicKeyPath]) {
    if (!existsSync(p)) {
      throw new Error(
        `JWT key not found at ${p}. Run backend/scripts/gen-dev-keys.sh (dev) or mount the key (prod).`,
      );
    }
  }

  cached = {
    ...env,
    jwtPrivateKeyPem: readFileSync(privateKeyPath, "utf8"),
    jwtPublicKeyPem: readFileSync(publicKeyPath, "utf8"),
    storageDir: abs(env.STORAGE_DIR),
  };
  return cached;
}

/** Injectable wrapper so modules depend on DI, not module-level state. */
export class ConfigService {
  readonly config: AppConfig = loadConfig();
}
