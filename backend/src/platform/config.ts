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
    /**
     * Delivery channel for the phone-OTP activation code:
     *   mock  — logs the code (development only)
     *   http  — generic SMS gateway (SMS_HTTP_URL + SMS_HTTP_API_KEY)
     *   usapp — Usapp tenant API (USAPP_BASE_URL + USAPP_API_KEY)
     */
    OTP_DELIVERY_DRIVER: z.enum(["mock", "http", "usapp"]).default("mock"),
    SMS_HTTP_URL: optionalEnv(z.url().optional()),
    SMS_HTTP_API_KEY: optionalEnv(z.string().min(1).optional()),
    /** Usapp tenant API — base origin, raw API key, and per-request timeout. */
    USAPP_BASE_URL: optionalEnv(z.url().optional()),
    USAPP_API_KEY: optionalEnv(z.string().min(1).optional()),
    USAPP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  })
  .superRefine((env, ctx) => {
    type DriverCredential =
      | "SMS_HTTP_URL"
      | "SMS_HTTP_API_KEY"
      | "USAPP_BASE_URL"
      | "USAPP_API_KEY";

    // Not named `require` — this file compiles to CommonJS, where that shadows
    // the module loader.
    const demand = (key: DriverCredential) => {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `required when OTP_DELIVERY_DRIVER=${env.OTP_DELIVERY_DRIVER}`,
        });
      }
    };

    // The mock driver logs codes and delivers none. Reaching production with it
    // selected -- most likely by not renaming SMS_DRIVER in a real .env file --
    // is a silent, total activation outage. Refuse to boot instead.
    // Staging sets NODE_ENV=production too (docker-compose.staging.yml), so it
    // is covered by this rule and must configure a real driver.
    if (env.NODE_ENV === "production" && env.OTP_DELIVERY_DRIVER === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["OTP_DELIVERY_DRIVER"],
        message:
          "must not be `mock` when NODE_ENV=production — it logs codes and delivers none. " +
          "Set `usapp` (or `http`). Staging runs NODE_ENV=production too, so it needs a real driver.",
      });
    }

    if (env.OTP_DELIVERY_DRIVER === "http") {
      demand("SMS_HTTP_URL");
      demand("SMS_HTTP_API_KEY");
    }
    if (env.OTP_DELIVERY_DRIVER === "usapp") {
      demand("USAPP_BASE_URL");
      demand("USAPP_API_KEY");
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
