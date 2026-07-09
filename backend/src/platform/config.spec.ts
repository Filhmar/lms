import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * loadConfig() memoizes into a module-level `cached` binding, so every case must
 * run against a freshly imported module — otherwise the first parse wins for the
 * whole file.
 *
 * Zod validation runs before the JWT key-file existence check, so the failure
 * cases below never touch the filesystem and the fake key paths are never read.
 */

const MANAGED_ENV = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_PRIVATE_KEY_PATH",
  "JWT_PUBLIC_KEY_PATH",
  "STORAGE_DIR",
  "METRICS_PORT",
  "VERIFY_PUBLIC_BASE",
  "SMS_DRIVER",
  "SMS_HTTP_URL",
  "SMS_HTTP_API_KEY",
] as const;

const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "/nonexistent/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "/nonexistent/jwt-public.pem",
  STORAGE_DIR: "/tmp/rl-storage",
};

describe("loadConfig", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of MANAGED_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    Object.assign(process.env, BASE_ENV);
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of MANAGED_ENV) {
      delete process.env[key];
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  });

  it("rejects SMS_DRIVER=http without SMS_HTTP_URL", async () => {
    process.env.SMS_DRIVER = "http";
    process.env.SMS_HTTP_URL = "";
    process.env.SMS_HTTP_API_KEY = "a-key";

    const { loadConfig } = await import("./config.js");

    expect(() => loadConfig()).toThrow(/SMS_HTTP_URL: required when SMS_DRIVER=http/);
  });

  it("rejects SMS_DRIVER=http without SMS_HTTP_API_KEY", async () => {
    process.env.SMS_DRIVER = "http";
    process.env.SMS_HTTP_URL = "https://sms.example/send";
    process.env.SMS_HTTP_API_KEY = "";

    const { loadConfig } = await import("./config.js");

    expect(() => loadConfig()).toThrow(/SMS_HTTP_API_KEY: required when SMS_DRIVER=http/);
  });
});
