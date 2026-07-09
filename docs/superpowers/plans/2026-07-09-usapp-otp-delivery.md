# Usapp OTP Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver LMS phone-OTP activation codes through Usapp's tenant messaging API, so that holding a registered Usapp account becomes a precondition for activating an LMS account.

**Architecture:** `SmsPort` becomes `OtpDeliveryPort` with three swappable drivers (`mock`, `http`, `usapp`) selected by `OTP_DELIVERY_DRIVER`. Drivers signal failure with three typed domain errors and never throw HTTP exceptions; `AuthService` is the only layer that maps those errors to status codes and student-facing copy. `requestActivation` is inverted to deliver *before* persisting, so a failed send can never invalidate a code the student is still holding.

**Tech Stack:** NestJS 11, Prisma 7, Zod 4, vitest 3 (new), Next.js 16, Turborepo + pnpm.

**Spec:** [docs/superpowers/specs/2026-07-09-usapp-otp-delivery-design.md](../specs/2026-07-09-usapp-otp-delivery-design.md)

**Branch:** `feat/usapp-otp-delivery` (already exists, spec committed as `16cef64`).

## Global Constraints

- Node `>=20`, pnpm `10.33.0`. Work from the repo root unless a step says otherwise.
- **Prerequisite for every typecheck and test run:** `cd backend && pnpm prisma:generate`. `backend/src/generated/prisma/` is gitignored and currently absent; `prisma.service.ts:4` imports `PrismaClient` from it as a *value*, so anything that loads `AuthService` needs it.
- **Never edit real `.env`, `.env.staging`, `.env.production`, or any deployed secret store.** Only the committed `.env*.example` templates, and only by appending/`sed`, never by overwriting.
- Student-facing copy must never contain the words `sync`, `server`, or `error` (CLAUDE.md microcopy rule).
- Drivers in `backend/src/platform/**` must never import Nest HTTP exceptions and must never own student-facing copy.
- The Usapp driver must **never log the `message` argument** — it carries the live OTP code. Phones in logs go through `maskPhone()`.
- LMS `PhPhoneSchema` is `+639XXXXXXXXX`; Usapp's `recipientPhone` is `^\+63\d{10}$`. These already agree — **do not add a normalization layer.**
- Usapp status contract (from `integration-service`): `201` delivered · `404` recipient has no Usapp account · `429` tenant rate limit · `401`/`403` bad key, revoked/expired key, inactive tenant, or egress IP missing from the tenant `ipAllowlist` · everything else is an upstream fault.
- Commit after every task. Do not squash.

---

### Task 1: Bootstrap vitest in the backend

The backend has zero tests and no runner. This task adds one and proves it works against a *characterization* test of config validation as it exists today. No product behavior changes.

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/tsconfig.build.json`
- Modify: `turbo.json`
- Modify: `package.json` (root)
- Create: `backend/vitest.config.ts`
- Test: `backend/src/platform/config.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm test` at the root and `pnpm test` inside `backend/`; the `MANAGED_ENV` / `BASE_ENV` test fixture in `config.spec.ts`, which Task 4 extends.

- [ ] **Step 1: Generate the Prisma client (prerequisite, not a code change)**

```bash
cd backend && pnpm prisma:generate && cd ..
```

Expected: `Generated Prisma Client` and `backend/src/generated/prisma/` now exists. This does not need a running database.

- [ ] **Step 2: Write the failing test**

Create `backend/src/platform/config.spec.ts`:

```ts
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

    const { loadConfig } = await import("./config");

    expect(() => loadConfig()).toThrow(/SMS_HTTP_URL: required when SMS_DRIVER=http/);
  });

  it("rejects SMS_DRIVER=http without SMS_HTTP_API_KEY", async () => {
    process.env.SMS_DRIVER = "http";
    process.env.SMS_HTTP_URL = "https://sms.example/send";
    process.env.SMS_HTTP_API_KEY = "";

    const { loadConfig } = await import("./config");

    expect(() => loadConfig()).toThrow(/SMS_HTTP_API_KEY: required when SMS_DRIVER=http/);
  });
});
```

> Note on `SMS_HTTP_URL: ""` rather than deleting it: `loadDotEnv()` writes any key from `backend/.env` that is currently `undefined`. Setting the empty string blocks that, and `optionalEnv` maps `""` back to `undefined` for Zod.

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && pnpm test
```

Expected: FAIL — `Command "test" not found` (there is no `test` script and no vitest yet).

- [ ] **Step 4: Add vitest and the test scripts**

Install:

```bash
pnpm --filter @rl/backend add -D vitest@^3.2.0
```

In `backend/package.json`, add to `"scripts"` (after `"typecheck"`):

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

Create `backend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

/**
 * esbuild (vitest's transformer) does not read `emitDecoratorMetadata` and does
 * not need to: these tests construct Nest providers directly rather than through
 * the DI container, so no design-time type metadata is required. It does need
 * `experimentalDecorators` to accept `@Injectable()` and `@Inject()`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
  esbuild: {
    target: "es2022",
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
});
```

- [ ] **Step 5: Keep spec files out of the production build**

`backend/tsconfig.build.json` currently excludes only `node_modules`, `dist`, and `scripts`, so `nest build` would emit compiled tests into `dist/`. Change its `"exclude"` array to:

```json
  "exclude": [
    "node_modules",
    "dist",
    "scripts",
    "**/*.spec.ts"
  ]
```

- [ ] **Step 6: Wire the task into Turborepo**

In `turbo.json`, add a `test` task after `"lint": {},`:

```json
    "test": {},
```

In the root `package.json`, add to `"scripts"` after `"lint"`:

```json
    "test": "turbo run test",
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd backend && pnpm test
```

Expected: PASS — `2 passed` in `src/platform/config.spec.ts`.

- [ ] **Step 8: Verify the build still excludes tests**

```bash
cd backend && pnpm build && find dist -name '*.spec.js' | wc -l
```

Expected: `pnpm build` succeeds and the count prints `0`.

- [ ] **Step 9: Commit**

```bash
git add backend/package.json backend/tsconfig.build.json backend/vitest.config.ts \
        backend/src/platform/config.spec.ts turbo.json package.json pnpm-lock.yaml
git commit -m "test: bootstrap vitest in the backend

The backend had no test runner. Adds vitest, a root and per-workspace \`test\`
script, a turbo task, and a characterization test pinning today's SMS_DRIVER=http
config validation. Excludes *.spec.ts from tsconfig.build.json so nest build no
longer emits compiled tests into dist/.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Rename the port and introduce typed domain errors

Move `platform/sms/` to `platform/otp-delivery/`, define the three errors, and make `HttpSmsDriver` throw `DeliveryUnavailableError` instead of Nest's `BadGatewayException`. The `SMS_DRIVER` config variable is **not** touched yet — that is Task 4.

**Files:**
- Create: `backend/src/platform/otp-delivery/otp-delivery.port.ts`
- Create: `backend/src/platform/otp-delivery/mock.driver.ts`
- Create: `backend/src/platform/otp-delivery/http-sms.driver.ts`
- Delete: `backend/src/platform/sms/sms.port.ts`, `backend/src/platform/sms/mock-sms.driver.ts`, `backend/src/platform/sms/http-sms.driver.ts`
- Modify: `backend/src/platform/platform.module.ts`
- Modify: `backend/src/modules/auth/auth.service.ts:24,58`
- Test: `backend/src/platform/otp-delivery/http-sms.driver.spec.ts`

**Interfaces:**
- Consumes: the vitest harness from Task 1.
- Produces:
  - `OTP_DELIVERY_PORT: symbol`
  - `class RecipientNotRegisteredError extends Error`
  - `class DeliveryRateLimitedError extends Error`
  - `class DeliveryUnavailableError extends Error`
  - `interface OtpDeliveryPort { send(phone: string, message: string): Promise<void> }`
  - `class MockDriver implements OtpDeliveryPort` (was `MockSmsDriver`)
  - `class HttpSmsDriver implements OtpDeliveryPort` (same name, new base error)

- [ ] **Step 1: Write the failing test**

Create `backend/src/platform/otp-delivery/http-sms.driver.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "../config";
import { HttpSmsDriver } from "./http-sms.driver";
import { DeliveryUnavailableError } from "./otp-delivery.port";

const CODE_MESSAGE = "Resilient-Learn code: 042317 — use this to set your password.";

function makeDriver(): HttpSmsDriver {
  const configService = {
    config: { SMS_HTTP_URL: "https://sms.example/send", SMS_HTTP_API_KEY: "a-key" },
  } as unknown as ConfigService;
  const driver = new HttpSmsDriver(configService);
  // Silence the Nest logger so a failing assertion isn't buried in output.
  Object.defineProperty(driver, "logger", {
    value: { error: () => {}, warn: () => {}, log: () => {} },
  });
  return driver;
}

describe("HttpSmsDriver", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("posts the message to the configured gateway with a bearer key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await makeDriver().send("+639171234567", CODE_MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sms.example/send");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer a-key");
    expect(JSON.parse(init.body as string)).toEqual({
      to: "+639171234567",
      message: CODE_MESSAGE,
    });
  });

  it("throws DeliveryUnavailableError when the gateway answers non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(makeDriver().send("+639171234567", CODE_MESSAGE)).rejects.toBeInstanceOf(
      DeliveryUnavailableError,
    );
  });

  it("throws DeliveryUnavailableError when the request never lands", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(makeDriver().send("+639171234567", CODE_MESSAGE)).rejects.toBeInstanceOf(
      DeliveryUnavailableError,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && pnpm vitest run src/platform/otp-delivery/http-sms.driver.spec.ts
```

Expected: FAIL — `Failed to load .../otp-delivery/http-sms.driver` (the directory does not exist).

- [ ] **Step 3: Create the port**

Create `backend/src/platform/otp-delivery/otp-delivery.port.ts`:

```ts
/**
 * OtpDeliveryPort — outbound one-time-code delivery behind a port (same pattern
 * as ObjectStorage): the activation flow depends on the interface only; drivers
 * are swapped by config (OTP_DELIVERY_DRIVER=mock|http|usapp), keeping
 * infrastructure portable per Annex A.
 *
 * Drivers signal failure with the domain errors below and never throw HTTP
 * exceptions: mapping to a status code and to student-facing copy belongs to the
 * auth module, not to infrastructure.
 */
export const OTP_DELIVERY_PORT = Symbol("OTP_DELIVERY_PORT");

/** The recipient holds no account on the delivery network (Usapp answers 404). */
export class RecipientNotRegisteredError extends Error {
  constructor(message = "Recipient is not registered on the delivery network") {
    super(message);
    this.name = "RecipientNotRegisteredError";
  }
}

/** The delivery network throttled us (Usapp answers 429). Retrying now deepens it. */
export class DeliveryRateLimitedError extends Error {
  constructor(message = "Delivery network rate limit exceeded") {
    super(message);
    this.name = "DeliveryRateLimitedError";
  }
}

/** Everything else: transport fault, timeout, 5xx, or a misconfigured tenant. */
export class DeliveryUnavailableError extends Error {
  constructor(message = "Delivery network is unavailable") {
    super(message);
    this.name = "DeliveryUnavailableError";
  }
}

export interface OtpDeliveryPort {
  /** Sends `message` to `phone` (E.164). Throws one of the errors above. */
  send(phone: string, message: string): Promise<void>;
}
```

- [ ] **Step 4: Create the mock driver**

Create `backend/src/platform/otp-delivery/mock.driver.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import type { OtpDeliveryPort } from "./otp-delivery.port";

/**
 * Dev/demo driver: logs the message instead of sending it. Never throws —
 * a missing delivery must not block local flows (the code is also surfaced as
 * `devCode` when NODE_ENV=development). Logging the code here is the point;
 * every other driver must keep it out of the log. The phone is masked all the
 * same — that rule has no exemption.
 */
@Injectable()
export class MockDriver implements OtpDeliveryPort {
  private readonly logger = new Logger("MockOtpDelivery");

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`OTP → ${maskPhone(phone)}: ${message}`);
  }
}
```

Import `maskPhone` from `@rl/schemas`, as `http-sms.driver.ts` does. Cover it with a
`mock.driver.spec.ts` asserting *both* halves of the rule: the masked phone is present
and the raw number is absent, **and** the OTP code is still logged. A test that checks
only the mask would pass if someone later stopped logging the code at all.

- [ ] **Step 5: Move the HTTP SMS driver onto the new error type**

Create `backend/src/platform/otp-delivery/http-sms.driver.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { maskPhone } from "@rl/schemas";
import { ConfigService } from "../config";
import { DeliveryUnavailableError, type OtpDeliveryPort } from "./otp-delivery.port";

/**
 * Generic HTTP SMS gateway driver: POST {to, message} as JSON with a bearer
 * key. Config (SMS_HTTP_URL / SMS_HTTP_API_KEY) is validated required at boot
 * when the driver is `http`. 5s timeout — a gateway must never hold a request
 * hostage.
 */
@Injectable()
export class HttpSmsDriver implements OtpDeliveryPort {
  private readonly logger = new Logger("HttpSmsOtpDelivery");

  constructor(private readonly configService: ConfigService) {}

  async send(phone: string, message: string): Promise<void> {
    const { SMS_HTTP_URL, SMS_HTTP_API_KEY } = this.configService.config;
    try {
      const response = await fetch(SMS_HTTP_URL!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SMS_HTTP_API_KEY}`,
        },
        body: JSON.stringify({ to: phone, message }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        throw new Error(`gateway responded ${response.status}`);
      }
    } catch (err) {
      // Log with a masked number — full phone numbers stay out of logs.
      this.logger.error(
        `SMS to ${maskPhone(phone)} did not go through: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new DeliveryUnavailableError();
    }
  }
}
```

- [ ] **Step 6: Delete the old directory**

```bash
git rm backend/src/platform/sms/sms.port.ts \
       backend/src/platform/sms/mock-sms.driver.ts \
       backend/src/platform/sms/http-sms.driver.ts
```

- [ ] **Step 7: Update `platform.module.ts`**

Replace the whole of `backend/src/platform/platform.module.ts` with:

```ts
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "./config";
import { HealthController } from "./health.controller";
import { HttpSmsDriver } from "./otp-delivery/http-sms.driver";
import { MockDriver } from "./otp-delivery/mock.driver";
import { OTP_DELIVERY_PORT } from "./otp-delivery/otp-delivery.port";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";
import { LocalFsStorage } from "./storage/local-fs.driver";
import { OBJECT_STORAGE } from "./storage/object-storage.port";

/**
 * Cross-cutting infrastructure: Zod-validated config (fail-fast), the shared
 * pg.Pool + PrismaClient, Redis, the ObjectStorage + OtpDelivery ports, and
 * /health. Global so feature modules never re-wire infrastructure.
 */
@Global()
@Module({
  controllers: [HealthController],
  providers: [
    ConfigService,
    PrismaService,
    RedisService,
    { provide: OBJECT_STORAGE, useClass: LocalFsStorage },
    MockDriver,
    HttpSmsDriver,
    {
      provide: OTP_DELIVERY_PORT,
      useFactory: (config: ConfigService, mock: MockDriver, http: HttpSmsDriver) =>
        config.config.SMS_DRIVER === "http" ? http : mock,
      inject: [ConfigService, MockDriver, HttpSmsDriver],
    },
  ],
  exports: [ConfigService, PrismaService, RedisService, OBJECT_STORAGE, OTP_DELIVERY_PORT],
})
export class PlatformModule {}
```

- [ ] **Step 8: Update the `AuthService` injection site**

In `backend/src/modules/auth/auth.service.ts`, replace line 24:

```ts
import { SMS_PORT, type SmsPort } from "../../platform/sms/sms.port";
```

with:

```ts
import {
  OTP_DELIVERY_PORT,
  type OtpDeliveryPort,
} from "../../platform/otp-delivery/otp-delivery.port";
```

and replace line 58:

```ts
    @Inject(SMS_PORT) private readonly sms: SmsPort,
```

with:

```ts
    @Inject(OTP_DELIVERY_PORT) private readonly delivery: OtpDeliveryPort,
```

Then update the single call site (currently line 162) from `this.sms.send(` to `this.delivery.send(`. Leave everything else in `requestActivation` alone — the reorder is Task 5.

- [ ] **Step 9: Run the tests and typecheck to verify they pass**

```bash
cd backend && pnpm test && pnpm typecheck
```

Expected: PASS — `6 passed` across `config.spec.ts`, `mock.driver.spec.ts`, and `http-sms.driver.spec.ts`; `tsc --noEmit` exits 0.

- [ ] **Step 10: Verify no stale references survive**

```bash
cd .. && git grep -n 'SMS_PORT\|SmsPort\|MockSmsDriver\|platform/sms' -- backend/src | wc -l
```

Expected: `0`.

- [ ] **Step 11: Commit**

```bash
git add -A backend/src/platform backend/src/modules/auth/auth.service.ts
git commit -m "refactor: rename SmsPort to OtpDeliveryPort, add typed domain errors

Usapp is an in-app messaging network, not an SMS gateway, so the port name no
longer described its primary driver. Drivers now signal failure with three plain
domain errors (RecipientNotRegistered / DeliveryRateLimited / DeliveryUnavailable)
instead of throwing Nest HTTP exceptions from the infrastructure layer, which
also makes them testable without Nest. No behavior change; SMS_DRIVER is renamed
in a later commit.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The Usapp driver

Build and fully test `UsappDriver` as a standalone class. It is **not wired into the DI factory yet** — that is Task 4. The `USAPP_*` config fields are added here because the driver reads them; the boot-time `superRefine` guard arrives in Task 4 alongside the `usapp` enum value.

**Files:**
- Create: `backend/src/platform/otp-delivery/usapp.driver.ts`
- Modify: `backend/src/platform/config.ts` (schema only — add three optional fields)
- Test: `backend/src/platform/otp-delivery/usapp.driver.spec.ts`

**Interfaces:**
- Consumes: `OtpDeliveryPort`, `RecipientNotRegisteredError`, `DeliveryRateLimitedError`, `DeliveryUnavailableError` from Task 2.
- Produces: `class UsappDriver implements OtpDeliveryPort`, constructed as `new UsappDriver(configService)`. Config gains `USAPP_BASE_URL?: string`, `USAPP_API_KEY?: string`, `USAPP_TIMEOUT_MS: number`.

- [ ] **Step 1: Add the config fields**

In `backend/src/platform/config.ts`, inside the `z.object({...})`, immediately after the `SMS_HTTP_API_KEY` line, add:

```ts
    /** Usapp tenant API — base origin, raw API key, and per-request timeout. */
    USAPP_BASE_URL: optionalEnv(z.url().optional()),
    USAPP_API_KEY: optionalEnv(z.string().min(1).optional()),
    USAPP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/platform/otp-delivery/usapp.driver.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "../config";
import {
  DeliveryRateLimitedError,
  DeliveryUnavailableError,
  RecipientNotRegisteredError,
} from "./otp-delivery.port";
import { UsappDriver } from "./usapp.driver";

const PHONE = "+639171234567";
const CODE = "042317";
const CODE_MESSAGE = `Resilient-Learn code: ${CODE} — use this to set your password. Valid 10 minutes.`;

/** Captures everything the driver logs so we can assert the code never appears. */
function makeDriver(baseUrl = "https://usapp.example.ph"): {
  driver: UsappDriver;
  logged: string[];
} {
  const configService = {
    config: {
      USAPP_BASE_URL: baseUrl,
      USAPP_API_KEY: "a-raw-key",
      USAPP_TIMEOUT_MS: 5000,
    },
  } as unknown as ConfigService;

  const driver = new UsappDriver(configService);
  const logged: string[] = [];
  Object.defineProperty(driver, "logger", {
    value: {
      error: (m: string) => logged.push(m),
      warn: (m: string) => logged.push(m),
      log: (m: string) => logged.push(m),
    },
  });
  return { driver, logged };
}

function stubFetch(status: number): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("UsappDriver", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("posts the message to the tenant API with the X-API-Key header", async () => {
    const fetchMock = stubFetch(201);
    const { driver } = makeDriver();

    await driver.send(PHONE, CODE_MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://usapp.example.ph/api/v1/messages/send");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("a-raw-key");
    expect(JSON.parse(init.body as string)).toEqual({
      recipientPhone: PHONE,
      content: CODE_MESSAGE,
      format: "plain",
    });
  });

  it("tolerates a trailing slash on USAPP_BASE_URL", async () => {
    const fetchMock = stubFetch(201);
    const { driver } = makeDriver("https://usapp.example.ph//");

    await driver.send(PHONE, CODE_MESSAGE);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://usapp.example.ph/api/v1/messages/send");
  });

  it("maps 404 to RecipientNotRegisteredError", async () => {
    stubFetch(404);
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(
      RecipientNotRegisteredError,
    );
  });

  it("maps 429 to DeliveryRateLimitedError", async () => {
    stubFetch(429);
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryRateLimitedError);
  });

  it.each([401, 403])("maps %i to DeliveryUnavailableError and names the likely causes", async (status) => {
    stubFetch(status);
    const { driver, logged } = makeDriver();

    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryUnavailableError);
    expect(logged.join("\n")).toMatch(/ipAllowlist/);
    expect(logged.join("\n")).toMatch(/USAPP_API_KEY/);
  });

  it.each([400, 500, 502])("maps %i to DeliveryUnavailableError", async (status) => {
    stubFetch(status);
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryUnavailableError);
  });

  it("maps a transport failure to DeliveryUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryUnavailableError);
  });

  it("maps a timeout to DeliveryUnavailableError", async () => {
    const abort = new Error("The operation was aborted due to timeout");
    abort.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    const { driver } = makeDriver();
    await expect(driver.send(PHONE, CODE_MESSAGE)).rejects.toBeInstanceOf(DeliveryUnavailableError);
  });

  it("never logs the OTP code, and masks the phone number", async () => {
    for (const status of [401, 500]) {
      stubFetch(status);
      const { driver, logged } = makeDriver();
      await driver.send(PHONE, CODE_MESSAGE).catch(() => {});

      const all = logged.join("\n");
      expect(all).not.toContain(CODE);
      expect(all).not.toContain(PHONE);
      vi.unstubAllGlobals();
    }
  });

  it("does not retry", async () => {
    const fetchMock = stubFetch(500);
    const { driver } = makeDriver();
    await driver.send(PHONE, CODE_MESSAGE).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && pnpm vitest run src/platform/otp-delivery/usapp.driver.spec.ts
```

Expected: FAIL — `Failed to load .../otp-delivery/usapp.driver`.

- [ ] **Step 4: Write the driver**

Create `backend/src/platform/otp-delivery/usapp.driver.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { maskPhone } from "@rl/schemas";
import { ConfigService } from "../config";
import {
  DeliveryRateLimitedError,
  DeliveryUnavailableError,
  RecipientNotRegisteredError,
  type OtpDeliveryPort,
} from "./otp-delivery.port";

/**
 * Usapp tenant-API driver. `POST /api/v1/messages/send` resolves recipientPhone
 * to a registered Usapp account and delivers an in-app message; a 404 means the
 * number has no Usapp account, which is exactly the activation prerequisite.
 *
 * Two rules this driver must keep:
 *   · never log `message` — it carries the live OTP code;
 *   · never retry — the call is user-triggered and rate-limited on both sides,
 *     so retrying a 429 deepens the hole and retrying a timeout can deliver two
 *     codes when the first request actually landed.
 */
@Injectable()
export class UsappDriver implements OtpDeliveryPort {
  private readonly logger = new Logger("UsappOtpDelivery");

  constructor(private readonly configService: ConfigService) {}

  async send(phone: string, message: string): Promise<void> {
    const { USAPP_BASE_URL, USAPP_API_KEY, USAPP_TIMEOUT_MS } = this.configService.config;
    const base = USAPP_BASE_URL!.replace(/\/+$/, "");

    let response: Response;
    try {
      response = await fetch(`${base}/api/v1/messages/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": USAPP_API_KEY!,
        },
        body: JSON.stringify({ recipientPhone: phone, content: message, format: "plain" }),
        signal: AbortSignal.timeout(USAPP_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `Usapp unreachable for ${maskPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new DeliveryUnavailableError();
    }

    if (response.ok) return;

    // Expected and actionable by the person activating — the auth module turns
    // this into copy. Not an operational fault, so it is not logged as one.
    if (response.status === 404) {
      throw new RecipientNotRegisteredError();
    }

    if (response.status === 429) {
      this.logger.warn(`Usapp rate-limited this tenant sending to ${maskPhone(phone)}`);
      throw new DeliveryRateLimitedError();
    }

    if (response.status === 401 || response.status === 403) {
      // Silent-until-someone-complains class of failure: name every cause, because
      // a generic "delivery failed" line buries the one thing an operator can fix.
      this.logger.error(
        `Usapp rejected this tenant (${response.status}) sending to ${maskPhone(phone)}. ` +
          `Check USAPP_API_KEY, that the key is neither revoked nor expired, that the ` +
          `tenant is active, and that this host's egress IP is in the tenant ipAllowlist.`,
      );
      throw new DeliveryUnavailableError();
    }

    this.logger.error(`Usapp answered ${response.status} sending to ${maskPhone(phone)}`);
    throw new DeliveryUnavailableError();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && pnpm test && pnpm typecheck
```

Expected: PASS — `19 passed` across four spec files (2 config + 1 mock + 3 http + 13 usapp); `tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**

```bash
git add backend/src/platform/config.ts \
        backend/src/platform/otp-delivery/usapp.driver.ts \
        backend/src/platform/otp-delivery/usapp.driver.spec.ts
git commit -m "feat: add the Usapp OTP delivery driver

POSTs to the Usapp tenant API's messages/send with an X-API-Key. Maps 404 to
RecipientNotRegisteredError (the phone holds no Usapp account), 429 to
DeliveryRateLimitedError, and 401/403 to DeliveryUnavailableError with a log line
naming every operator-fixable cause, including the tenant ipAllowlist.

Never logs the message body, which carries the live OTP code. Never retries.
Not yet wired into the DI factory.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Rename `SMS_DRIVER` and wire the driver in

**Files:**
- Modify: `backend/src/platform/config.ts`
- Modify: `backend/src/platform/config.spec.ts`
- Modify: `backend/src/platform/platform.module.ts`
- Modify: `backend/src/modules/auth/auth.service.ts` (the `devCode` guard, currently line 173)
- Modify: `docker-compose.yml:27-30`
- Modify: `CLAUDE.md:96`
- Modify: `.env.example`, `.env.staging.example`, `.env.production.example`

**Interfaces:**
- Consumes: `UsappDriver` from Task 3; `MockDriver` / `HttpSmsDriver` / `OTP_DELIVERY_PORT` from Task 2.
- Produces: `AppConfig.OTP_DELIVERY_DRIVER: "mock" | "http" | "usapp"`. `AppConfig.SMS_DRIVER` no longer exists.

> **This is a breaking configuration change.** Real `.env.staging`, `.env.production`, and any deployed secret store must be updated by hand before the next deploy, or the backend fails fast at boot with `Invalid environment configuration`. That fail-fast is deliberate: a silent fallback to `mock` in production would log every OTP to stdout and deliver none.

- [ ] **Step 1: Update the failing test first**

In `backend/src/platform/config.spec.ts`, replace the final three entries of `MANAGED_ENV` (`"SMS_DRIVER"`, `"SMS_HTTP_URL"`, `"SMS_HTTP_API_KEY"`) so the array's tail reads:

```ts
  "OTP_DELIVERY_DRIVER",
  "SMS_HTTP_URL",
  "SMS_HTTP_API_KEY",
  "USAPP_BASE_URL",
  "USAPP_API_KEY",
  "USAPP_TIMEOUT_MS",
] as const;
```

Then replace both existing `it(...)` blocks with these four:

```ts
  it("rejects OTP_DELIVERY_DRIVER=http without SMS_HTTP_URL", async () => {
    process.env.OTP_DELIVERY_DRIVER = "http";
    process.env.SMS_HTTP_URL = "";
    process.env.SMS_HTTP_API_KEY = "a-key";

    const { loadConfig } = await import("./config");

    expect(() => loadConfig()).toThrow(
      /SMS_HTTP_URL: required when OTP_DELIVERY_DRIVER=http/,
    );
  });

  it("rejects OTP_DELIVERY_DRIVER=usapp without USAPP_BASE_URL", async () => {
    process.env.OTP_DELIVERY_DRIVER = "usapp";
    process.env.USAPP_BASE_URL = "";
    process.env.USAPP_API_KEY = "a-raw-key";

    const { loadConfig } = await import("./config");

    expect(() => loadConfig()).toThrow(
      /USAPP_BASE_URL: required when OTP_DELIVERY_DRIVER=usapp/,
    );
  });

  it("rejects OTP_DELIVERY_DRIVER=usapp without USAPP_API_KEY", async () => {
    process.env.OTP_DELIVERY_DRIVER = "usapp";
    process.env.USAPP_BASE_URL = "https://usapp.example.ph";
    process.env.USAPP_API_KEY = "";

    const { loadConfig } = await import("./config");

    expect(() => loadConfig()).toThrow(
      /USAPP_API_KEY: required when OTP_DELIVERY_DRIVER=usapp/,
    );
  });

  it("rejects an unknown driver name", async () => {
    process.env.OTP_DELIVERY_DRIVER = "twilio";

    const { loadConfig } = await import("./config");

    expect(() => loadConfig()).toThrow(/OTP_DELIVERY_DRIVER/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && pnpm vitest run src/platform/config.spec.ts
```

Expected: FAIL — all four. The first three throw with `SMS_DRIVER` in the message rather than `OTP_DELIVERY_DRIVER`. The fourth throws `JWT key not found at /nonexistent/jwt-private.pem`: the old schema ignores the unknown `OTP_DELIVERY_DRIVER` var entirely, so Zod passes and execution reaches the key-file check. Once the enum exists, Zod rejects `twilio` before the filesystem is touched.

- [ ] **Step 3: Rename the variable and add the `usapp` guard**

In `backend/src/platform/config.ts`, replace the `SMS_DRIVER` line:

```ts
    /** SMS driver for phone-OTP activation: mock (logs the code) or http gateway. */
    SMS_DRIVER: z.enum(["mock", "http"]).default("mock"),
```

with:

```ts
    /**
     * Delivery channel for the phone-OTP activation code:
     *   mock  — logs the code (development only)
     *   http  — generic SMS gateway (SMS_HTTP_URL + SMS_HTTP_API_KEY)
     *   usapp — Usapp tenant API (USAPP_BASE_URL + USAPP_API_KEY)
     */
    OTP_DELIVERY_DRIVER: z.enum(["mock", "http", "usapp"]).default("mock"),
```

Then replace the whole `.superRefine((env, ctx) => {...})` block with:

```ts
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

    if (env.OTP_DELIVERY_DRIVER === "http") {
      demand("SMS_HTTP_URL");
      demand("SMS_HTTP_API_KEY");
    }
    if (env.OTP_DELIVERY_DRIVER === "usapp") {
      demand("USAPP_BASE_URL");
      demand("USAPP_API_KEY");
    }
  });
```

- [ ] **Step 4: Wire `UsappDriver` into the factory**

In `backend/src/platform/platform.module.ts`, add the import (alphabetical, after the `OTP_DELIVERY_PORT` import):

```ts
import { UsappDriver } from "./otp-delivery/usapp.driver";
```

Add `UsappDriver,` to `providers` right after `HttpSmsDriver,`, and replace the `OTP_DELIVERY_PORT` provider with:

```ts
    {
      provide: OTP_DELIVERY_PORT,
      useFactory: (
        config: ConfigService,
        mock: MockDriver,
        http: HttpSmsDriver,
        usapp: UsappDriver,
      ): OtpDeliveryPort => {
        switch (config.config.OTP_DELIVERY_DRIVER) {
          case "usapp":
            return usapp;
          case "http":
            return http;
          default:
            return mock;
        }
      },
      inject: [ConfigService, MockDriver, HttpSmsDriver, UsappDriver],
    },
```

Widen the port import to bring in the type:

```ts
import { OTP_DELIVERY_PORT, type OtpDeliveryPort } from "./otp-delivery/otp-delivery.port";
```

- [ ] **Step 5: Update the `devCode` guard**

In `backend/src/modules/auth/auth.service.ts` (currently line 173), replace:

```ts
    if (cfg.NODE_ENV === "development" && cfg.SMS_DRIVER === "mock") {
```

with:

```ts
    if (cfg.NODE_ENV === "development" && cfg.OTP_DELIVERY_DRIVER === "mock") {
```

- [ ] **Step 6: Update `docker-compose.yml`**

Replace lines 27–30 (the `# Phone-OTP activation SMS:` comment and the three `SMS_*` entries) with:

```yaml
  # Delivery channel for phone-OTP activation codes:
  #   mock  = log the code (development only)
  #   http  = generic SMS gateway (SMS_HTTP_URL + SMS_HTTP_API_KEY required)
  #   usapp = Usapp tenant API (USAPP_BASE_URL + USAPP_API_KEY required)
  OTP_DELIVERY_DRIVER: ${OTP_DELIVERY_DRIVER:-mock}
  SMS_HTTP_URL: ${SMS_HTTP_URL:-}
  SMS_HTTP_API_KEY: ${SMS_HTTP_API_KEY:-}
  USAPP_BASE_URL: ${USAPP_BASE_URL:-}
  USAPP_API_KEY: ${USAPP_API_KEY:-}
  USAPP_TIMEOUT_MS: ${USAPP_TIMEOUT_MS:-5000}
```

- [ ] **Step 7: Update the `.env*.example` templates**

These are committed templates with no secrets. **Append and delete by line — never overwrite the file.** Run from the repo root:

```bash
sed -i '/^SMS_DRIVER=/d' .env.example .env.staging.example .env.production.example

for f in .env.example .env.staging.example .env.production.example; do
  grep -q '^OTP_DELIVERY_DRIVER' "$f" || cat >> "$f" <<'EOF'

# --- OTP delivery ------------------------------------------------------------
# mock  = log the code (development only)
# http  = generic SMS gateway (SMS_HTTP_URL + SMS_HTTP_API_KEY required)
# usapp = Usapp tenant API (USAPP_BASE_URL + USAPP_API_KEY required)
OTP_DELIVERY_DRIVER=mock
SMS_HTTP_URL=
SMS_HTTP_API_KEY=
USAPP_BASE_URL=
USAPP_API_KEY=
USAPP_TIMEOUT_MS=5000
EOF
done

git diff --stat -- '.env*.example'
```

Expected: three files changed. Read `git diff -- '.env*.example'` before continuing; if any file already carried a `USAPP_` or `OTP_DELIVERY_` key, reconcile by hand rather than accepting a duplicate.

- [ ] **Step 8: Update `CLAUDE.md`**

At line 96, replace:

```
  `pending_activation` with a PH mobile; activation = phone OTP
  (`SMS_DRIVER=mock` logs codes and returns `devCode` in development;
  `http` posts to your SMS gateway). Role↔level invariant is enforced
```

with:

```
  `pending_activation` with a PH mobile; activation = phone OTP
  (`OTP_DELIVERY_DRIVER=mock` logs codes and returns `devCode` in development;
  `http` posts to an SMS gateway; `usapp` posts to the Usapp tenant API, which
  404s unless the number holds a registered Usapp account). Role↔level invariant
  is enforced
```

- [ ] **Step 9: Run the tests and typecheck to verify they pass**

```bash
cd backend && pnpm test && pnpm typecheck && cd .. && git grep -n 'SMS_DRIVER' -- backend docker-compose.yml CLAUDE.md | wc -l
```

Expected: `23 passed` (config grows from 2 tests to 4); `tsc --noEmit` exits 0; the `git grep | wc -l` prints `0`.

- [ ] **Step 10: Verify the container config still resolves**

Skip this step if Docker isn't running.

```bash
docker compose -f docker-compose.yml -f docker-compose.development.yml config >/dev/null && echo OK
```

Expected: `OK`. (This command only reads compose files; it does not create or overwrite any `.env`.)

- [ ] **Step 11: Commit**

```bash
git add backend/src/platform/config.ts backend/src/platform/config.spec.ts \
        backend/src/platform/platform.module.ts backend/src/modules/auth/auth.service.ts \
        docker-compose.yml CLAUDE.md .env.example .env.staging.example .env.production.example
git commit -m "feat: select the OTP channel with OTP_DELIVERY_DRIVER

Renames SMS_DRIVER, adds the usapp value, and wires UsappDriver into the platform
factory. Boot now fails fast when the chosen driver's credentials are missing.

BREAKING: real .env.staging / .env.production and any deployed secret store must
rename SMS_DRIVER to OTP_DELIVERY_DRIVER before the next deploy. The fail-fast is
intentional -- a silent fallback to mock in production would log every OTP to
stdout and deliver none.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Send before persisting, and map errors to HTTP

The heart of the change. `requestActivation` currently supersedes the old OTP, writes a new one, *then* sends — so a 404 from Usapp destroys a code the student may still be holding and stores a dead one. Invert it, and make the supersede-plus-issue atomic.

**Files:**
- Modify: `packages/schemas/src/index.ts:247-258`
- Modify: `backend/src/modules/auth/auth.repository.ts:49-66`
- Modify: `backend/src/modules/auth/auth.service.ts`
- Test: `backend/src/modules/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: the three error classes from Task 2; `AppConfig.OTP_DELIVERY_DRIVER` from Task 4.
- Produces:
  - `AuthRepository.replaceActivationOtp(input: { userId: string; phone: string; codeHash: string; expiresAt: Date }): Promise<void>` — replaces `consumeActivationOtps()` and `createActivationOtp()`, both deleted.
  - `ActivationRequestResponse.channel: "usapp" | "sms"`.
  - `AuthService` constructor order is unchanged: `(repo, jwtService, jwksService, configService, redis, delivery)`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/auth/auth.service.spec.ts`:

```ts
import {
  BadGatewayException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryRateLimitedError,
  DeliveryUnavailableError,
  RecipientNotRegisteredError,
} from "../../platform/otp-delivery/otp-delivery.port";
import { AuthService } from "./auth.service";

const PENDING_USER = {
  id: "user-1",
  email: "ana.reyes@deped.gov.ph",
  fullName: "Ana Reyes",
  role: "student",
  scopeId: "scope-1",
  status: "pending_activation",
  phone: "+639171234567",
};

function makeService(send: () => Promise<void>) {
  const repo = {
    findUserByEmail: vi.fn().mockResolvedValue(PENDING_USER),
    replaceActivationOtp: vi.fn().mockResolvedValue(undefined),
  };
  const redis = {
    client: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
  };
  const configService = {
    config: { NODE_ENV: "test", OTP_DELIVERY_DRIVER: "usapp" },
  };
  const delivery = { send: vi.fn(send) };

  const service = new AuthService(
    repo as never,
    {} as never, // JwtService — unused by requestActivation
    {} as never, // JwksService — unused by requestActivation
    configService as never,
    redis as never,
    delivery as never,
  );

  return { service, repo, delivery };
}

describe("AuthService.requestActivation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delivers the code, then persists it, and reports the channel", async () => {
    const { service, repo, delivery } = makeService(async () => {});

    const res = await service.requestActivation(PENDING_USER.email, "203.0.113.7");

    expect(delivery.send).toHaveBeenCalledTimes(1);
    expect(repo.replaceActivationOtp).toHaveBeenCalledTimes(1);
    expect(res.channel).toBe("usapp");
    expect(res.maskedPhone).toBe("+63••••••4567");
    expect(res.devCode).toBeUndefined();
  });

  it("sends the six-digit code inside the message it delivers", async () => {
    const { service, delivery } = makeService(async () => {});

    await service.requestActivation(PENDING_USER.email, "203.0.113.7");

    const [phone, message] = delivery.send.mock.calls[0] as [string, string];
    expect(phone).toBe(PENDING_USER.phone);
    expect(message).toMatch(/Resilient-Learn code: \d{6}/);
  });

  it("answers 409 and burns no code when the number is not on Usapp", async () => {
    const { service, repo } = makeService(async () => {
      throw new RecipientNotRegisteredError();
    });

    await expect(service.requestActivation(PENDING_USER.email, "203.0.113.7")).rejects.toBeInstanceOf(
      ConflictException,
    );

    // The invariant this whole change exists to protect: a failed delivery must
    // never invalidate a code the student is still holding.
    expect(repo.replaceActivationOtp).not.toHaveBeenCalled();
  });

  it("answers 503 and burns no code when the delivery network throttles us", async () => {
    const { service, repo } = makeService(async () => {
      throw new DeliveryRateLimitedError();
    });

    await expect(service.requestActivation(PENDING_USER.email, "203.0.113.7")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(repo.replaceActivationOtp).not.toHaveBeenCalled();
  });

  it("answers 502 and burns no code when the delivery network is down", async () => {
    const { service, repo } = makeService(async () => {
      throw new DeliveryUnavailableError();
    });

    await expect(service.requestActivation(PENDING_USER.email, "203.0.113.7")).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(repo.replaceActivationOtp).not.toHaveBeenCalled();
  });

  it("never delivers to an account that is not pending activation", async () => {
    const { service, delivery, repo } = makeService(async () => {});
    repo.findUserByEmail.mockResolvedValue({ ...PENDING_USER, status: "active" });

    await expect(service.requestActivation(PENDING_USER.email, "203.0.113.7")).rejects.toThrow(
      /can't activate this account/,
    );
    expect(delivery.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && pnpm vitest run src/modules/auth/auth.service.spec.ts
```

Expected: FAIL — several failures, the load-bearing one being `expected "replaceActivationOtp" to not be called` in the 409 case (today's code persists before sending, and `replaceActivationOtp` does not yet exist).

- [ ] **Step 3: Add `channel` to the shared schema**

In `packages/schemas/src/index.ts`, replace lines 247–258 with:

```ts
/** The channel the activation code went out over — decides which copy to show. */
export const OtpChannelSchema = z.enum(["usapp", "sms"]);
export type OtpChannel = z.infer<typeof OtpChannelSchema>;

export const ActivationRequestResponseSchema = z.object({
  /** e.g. +63••••••1234 — never the full number. */
  maskedPhone: z.string(),
  expiresInSec: z.number().int().positive(),
  /** Where the code was delivered: the Usapp app, or an SMS. */
  channel: OtpChannelSchema,
  /**
   * Development convenience ONLY (OTP_DELIVERY_DRIVER=mock + NODE_ENV=development):
   * the code is surfaced so flows can be exercised without a real delivery
   * network. Absent in staging/production.
   */
  devCode: z.string().optional(),
});
export type ActivationRequestResponse = z.infer<typeof ActivationRequestResponseSchema>;
```

- [ ] **Step 4: Make supersede-plus-issue atomic in the repository**

In `backend/src/modules/auth/auth.repository.ts`, delete `consumeActivationOtps()` (lines 49–55) and `createActivationOtp()` (lines 57–66) — nothing else calls them — and put this in their place:

```ts
  /**
   * Supersede every unconsumed code and issue a fresh one, atomically. Two
   * separate statements could crash between them and leave the account with no
   * valid code and no record of why.
   */
  async replaceActivationOtp(input: {
    userId: string;
    phone: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.client.$transaction([
      this.prisma.client.otpRequest.updateMany({
        where: { userId: input.userId, purpose: ACTIVATION, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.client.otpRequest.create({ data: { ...input, purpose: ACTIVATION } }),
    ]);
  }
```

Leave the `import type { OtpRequest, RefreshToken, User }` on line 3 alone: `findLatestActivationOtp()` still returns `Promise<OtpRequest | null>`.

- [ ] **Step 5: Invert `requestActivation` and map the errors**

In `backend/src/modules/auth/auth.service.ts`, extend the Nest import on lines 2–11 to add `BadGatewayException`, `ConflictException`, and `ServiceUnavailableException` (keep the list alphabetical):

```ts
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
```

Extend the port import from Task 2 to pull in the errors:

```ts
import {
  DeliveryRateLimitedError,
  DeliveryUnavailableError,
  OTP_DELIVERY_PORT,
  RecipientNotRegisteredError,
  type OtpDeliveryPort,
} from "../../platform/otp-delivery/otp-delivery.port";
```

After the `TOO_MANY_CODES` constant (line 36–37), add:

```ts
const NOT_ON_USAPP =
  "That number isn't on Usapp yet. Install Usapp, register this number, then request your code.";
const DELIVERY_BUSY = "We're sending a lot of codes right now. Try again in a few minutes.";
const DELIVERY_FAILED = "We couldn't send your code right now — try again in a few minutes.";
```

Replace the whole body of `requestActivation` (lines 143–177) with:

```ts
  async requestActivation(email: string, ip: string): Promise<ActivationRequestResponse> {
    // IP limit first — it also throttles enumeration probing.
    await this.enforceRateLimit(`otp:rl:ip:${ip}`, RATE_LIMIT_PER_IP);

    const user = await this.repo.findUserByEmail(email.toLowerCase());
    if (!user || user.status !== "pending_activation" || !user.phone) {
      throw new NotFoundException(CANNOT_ACTIVATE);
    }
    await this.enforceRateLimit(`otp:rl:user:${user.id}`, RATE_LIMIT_PER_USER);

    const cfg = this.configService.config;
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

    // Deliver BEFORE persisting. A failed send must never supersede a code the
    // owner is still holding, nor store one that was never delivered. The
    // inverse risk — delivered, then the write fails — leaves the old codes
    // valid and is the rarer half, since the network call is what breaks.
    try {
      await this.delivery.send(
        user.phone,
        `Resilient-Learn code: ${code} — use this to set your password. Valid 10 minutes.`,
      );
    } catch (err) {
      if (err instanceof RecipientNotRegisteredError) throw new ConflictException(NOT_ON_USAPP);
      if (err instanceof DeliveryRateLimitedError) {
        throw new ServiceUnavailableException(DELIVERY_BUSY);
      }
      if (err instanceof DeliveryUnavailableError) throw new BadGatewayException(DELIVERY_FAILED);
      throw err;
    }

    await this.repo.replaceActivationOtp({
      userId: user.id,
      phone: user.phone,
      codeHash: this.hashToken(code),
      expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000),
    });

    const response: ActivationRequestResponse = {
      maskedPhone: maskPhone(user.phone),
      expiresInSec: OTP_TTL_SEC,
      channel: cfg.OTP_DELIVERY_DRIVER === "usapp" ? "usapp" : "sms",
    };
    // Dev convenience ONLY — never in staging/production.
    if (cfg.NODE_ENV === "development" && cfg.OTP_DELIVERY_DRIVER === "mock") {
      response.devCode = code;
    }
    return response;
  }
```

- [ ] **Step 6: Make the confirm-step copy channel-neutral**

Still in `auth.service.ts`, the mismatch message on line 210 names SMS. Replace:

```ts
      throw new BadRequestException("That code didn't match. Check the SMS and try again.");
```

with:

```ts
      throw new BadRequestException("That code didn't match. Check the code and try again.");
```

Also update the class doc-comment on lines 44–46, replacing `a 6-digit SMS code` with `a 6-digit code delivered to their phone`.

- [ ] **Step 7: Run the tests and typecheck to verify they pass**

```bash
cd backend && pnpm test && pnpm typecheck && cd .. && pnpm --filter @rl/schemas typecheck
```

Expected: PASS — `31 passed` across five spec files (6 config + 1 mock + 3 http + 15 usapp + 6 auth); both typechecks exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src/index.ts \
        backend/src/modules/auth/auth.repository.ts \
        backend/src/modules/auth/auth.service.ts \
        backend/src/modules/auth/auth.service.spec.ts
git commit -m "fix: deliver the activation code before persisting it

requestActivation superseded the old OTP and wrote a new one before sending, so
an undeliverable code destroyed one the student may still have been holding and
stored a dead row. Sending now happens first; nothing is persisted unless the
delivery network accepted the message.

Supersede-plus-issue becomes one transaction (replaceActivationOtp), replacing
two sequential statements that could crash between them.

Maps the three delivery errors to 409 / 503 / 502, and returns the delivery
channel so the client can name it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Channel-accurate copy on the activation screen

The screen promises an SMS four times. Under `usapp` a student would wait for a text that never arrives.

**Files:**
- Modify: `frontend/lib/copy.ts`
- Modify: `frontend/app/activate/page.tsx`

**Interfaces:**
- Consumes: `ActivationRequestResponse.channel` from Task 5.
- Produces: `activation` copy record in `frontend/lib/copy.ts`, keyed by `OtpChannel`.

There is no test runner in `frontend`, and adding one is out of scope. Verification is `typecheck` plus driving the real screen.

- [ ] **Step 1: Add the copy block**

Append to `frontend/lib/copy.ts`, after the `environment` block:

```ts
/**
 * Activation step 2, keyed by the channel the code actually went out over.
 * Step 1 cannot know the channel yet — nothing has been requested — so its CTA
 * stays neutral ("Send me the code").
 */
export const activation = {
  usapp: {
    sentPrefix: "We sent a 6-digit code to your Usapp app on",
    codeHint: "Enter the 6 digits from your Usapp message.",
    mismatch: "That code didn't match — check your Usapp message and try again.",
    resend: "Didn't get it? Send it again",
  },
  sms: {
    sentPrefix: "We texted a 6-digit code to",
    codeHint: "Enter the 6 digits from the text message.",
    mismatch: "That code didn't match — check the text message and try again.",
    resend: "Didn't get the text? Send it again",
  },
} as const;
```

- [ ] **Step 2: Import the copy and resolve the channel once**

In `frontend/app/activate/page.tsx`, insert after line 16 (`import { ApiError, apiPost } from "@/lib/api";`), keeping the `@/lib/*` imports alphabetical:

```ts
import { activation } from "@/lib/copy";
```

Inside `ActivatePage`, after the `codeOk` line (line 104), add:

```ts
  // `sms` until the request answers; step 1 never shows channel-specific copy.
  const t = challenge ? activation[challenge.channel] : activation.sms;
```

- [ ] **Step 3: Replace the four SMS-specific strings**

Line 158, inside `confirm()`:

```ts
        setConfirmError(err.message || t.mismatch);
```

Lines 187–188, the step-1 intro:

```tsx
            Your school created an account for you. Enter your email and we&rsquo;ll send a 6-digit
            code to the phone number on file.
```

Line 220, the step-1 CTA:

```tsx
              {busy ? "Sending the code…" : "Send me the code"}
```

Line 244, the step-2 lede:

```tsx
            {t.sentPrefix}{" "}
```

Line 285, the code field's validation hint:

```tsx
              error={attempted && !codeOk ? t.codeHint : undefined}
```

Line 339, the resend button:

```tsx
              {t.resend}
```

- [ ] **Step 4: Verify no SMS-specific copy survives**

Scope the search to `frontend/app` — `frontend/lib/copy.ts` is *supposed* to contain those strings, inside its `sms` branch.

```bash
git grep -niE 'text me|we texted|text message|didn.t get the text' -- frontend/app | wc -l
```

Expected: `0`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter frontend typecheck
```

Expected: exits 0. (If `challenge.channel` errors as unknown, `packages/schemas` was not rebuilt — it is source-only, so re-run from the repo root.)

- [ ] **Step 6: Drive the screen**

```bash
backend/scripts/dev-services.sh
cd backend && pnpm prisma migrate dev && pnpm seed && pnpm dev
# in a second shell:
cd frontend && pnpm dev
```

With `OTP_DELIVERY_DRIVER` unset (so `mock`), open `http://localhost:3000/activate`, enter a seeded `pending_activation` email, and confirm:

1. the step-1 button reads **"Send me the code"**;
2. step 2 reads **"We texted a 6-digit code to +63••••••…"** (channel `sms`, because `mock` reports `sms`);
3. the `dev code · NNNNNN` chip appears and the code activates the account.

Then stop the backend, set `OTP_DELIVERY_DRIVER=usapp` with a bad `USAPP_BASE_URL` (e.g. `http://localhost:1`), restart, and request a code for the same email. Confirm the screen shows the calm banner **"We couldn't send your code right now — try again in a few minutes."** and that requesting again still works — proving no code was burned.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/copy.ts frontend/app/activate/page.tsx
git commit -m "fix: name the channel the activation code was actually sent over

The screen promised a text message four times. Under the usapp driver the code
arrives in the Usapp app, so a student would wait for an SMS that never comes.
Step 2 now keys its copy off the channel the API reports; step 1, which cannot
know the channel yet, asks neutrally.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done when

- `pnpm test` is green from the repo root (31 tests across five backend spec files).
- `pnpm typecheck` is green across every workspace.
- `git grep -n 'SMS_DRIVER\|SmsPort\|SMS_PORT'` returns nothing outside the spec and this plan.
- With `OTP_DELIVERY_DRIVER=usapp` and an unreachable base URL, requesting a code twice in a row both fails calmly *and* leaves any previously issued code usable.

## Deferred to the operator

Neither of these belongs in a commit; both must happen before the first staging run.

1. **Rename `SMS_DRIVER` to `OTP_DELIVERY_DRIVER`** in the real `.env.staging`, `.env.production`, and any deployed secret store, and add `USAPP_BASE_URL` + `USAPP_API_KEY`. The backend refuses to boot otherwise, by design.
2. **Add the backend's egress IP (or its CIDR) to the LMS tenant's `ipAllowlist`** in Usapp. Every send returns `403` until then, and the failure presents as a generic delivery outage — the `401/403` log line from Task 3 is what will tell you.
