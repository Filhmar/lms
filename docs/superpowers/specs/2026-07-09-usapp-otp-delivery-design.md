# Usapp as the OTP delivery channel

**Date:** 2026-07-09
**Status:** Approved, ready for implementation planning
**Scope:** `backend` (platform + auth module), `packages/schemas`, `frontend` (activation screen)

## Problem

Phase I account activation sends a 6-digit code to a pending user's phone through
`SmsPort` (`SMS_DRIVER=mock|http`). We want that code delivered through **Usapp**, the
messaging application, so that (a) a person must hold a registered Usapp account to
activate an LMS account, and (b) future LMS notifications ride the same channel.

LMS becomes a tenant of Usapp's integration service on the `INTERNAL` plan.

## What Usapp's tenant API actually is

`POST /api/v1/messages/send` is **not an SMS gateway**. It resolves `recipientPhone` to a
registered Usapp user via user-service, then delivers an in-app message and a WebSocket
push. If the number has no Usapp account it returns **`404 Recipient not found`**
(`integration-service.service.ts`, the `user/search-user-by-phone` lookup).

That 404 *is* the registration requirement. Usapp enforces it; LMS does not reimplement it.

**Do not trust `docs/USAPP-API-DOCS.yaml` on this point.** That file is generated from
`@ApiResponse` decorators, and `sendMessage` in Usapp's `tenant.controller.ts` declares only
`201`/`400`/`401`/`403`/`429` — it never declares the `404`. The 404 is nonetheless real and
reachable: `integration-service.service.ts:703` and `:713` both throw
`NotFoundException('Recipient not found')`, once when the user-service lookup 404s and once
when it resolves no user id. The published OpenAPI document is incomplete, not authoritative.

Two consequences that shape the design:

- **There is no phone-lookup endpoint** on the tenant API. The only way to learn whether a
  number is on Usapp is to send it a message. Registration therefore cannot be pre-checked
  at admin user-create or CSV-import time.
- **LMS's `PhPhoneSchema` (`+639XXXXXXXXX`) already satisfies Usapp's `recipientPhone`
  pattern (`^\+63\d{10}$`).** No normalization layer is needed.

Relevant tenant-API facts:

| Fact | Value |
|---|---|
| Auth | `X-API-Key` header |
| Scope required | `messages:send` |
| IP allowlist | **Mandatory** on the tenant; a request from an unlisted IP is `403` |
| `INTERNAL` plan | unlimited monthly quota, 50 req/s, 1000 req/min |
| Global IP throttler | explicitly skipped on `messages/send` |

The LMS tenant and its API key already exist. Provisioning is out of scope; the backend
receives `USAPP_BASE_URL` and `USAPP_API_KEY` as environment/secrets.

## Decisions

1. A `404` from Usapp surfaces as its own LMS error, and **no OTP row is written unless
   Usapp accepted the message**. Usapp stays the sole source of truth for registration;
   LMS keeps no mirror state.
2. The message body is sent as direct `content`. No Usapp template, no per-environment
   template provisioning, no template-approval failure mode.
3. `SmsPort` / `SMS_DRIVER` are renamed to `OtpDeliveryPort` / `OTP_DELIVERY_DRIVER`, and
   user-facing copy names the channel that was actually used.
4. Drivers report failure via typed domain errors. `auth.service` is the only layer that
   knows HTTP status codes and student-facing copy.

## 1. Configuration

`SMS_DRIVER` → `OTP_DELIVERY_DRIVER` (`mock` | `http` | `usapp`, default `mock`).

New vars, required by `superRefine` **only** when the driver is `usapp`:

```
USAPP_BASE_URL     e.g. https://usapp.example.ph
USAPP_API_KEY      raw key, shown once at generation
USAPP_TIMEOUT_MS   default 5000
```

`SMS_HTTP_URL` / `SMS_HTTP_API_KEY` keep their names — the `http` driver really is an SMS
gateway, and it remains supported.

Files touched: `backend/src/platform/config.ts`, `docker-compose.yml` (lines 28–30),
`.env.example`, `.env.staging.example`, `.env.production.example`, `CLAUDE.md`.

### Operator action required before the next deploy

Renaming the variable means real `.env.staging`, `.env.production`, and any deployed secret
store **must be updated by hand**. The backend fails fast at boot with
`Invalid environment configuration` otherwise.

That fail-fast is deliberate and must not be softened: a silent fallback to the `mock`
driver in production would log every OTP to stdout and deliver none of them.

Because `OTP_DELIVERY_DRIVER` *defaults* to `mock`, a forgotten rename would otherwise boot
cleanly and keep answering `200` while delivering nothing. The schema therefore also refuses
to boot when `NODE_ENV=production` selects `mock`, whether explicitly or by falling through
to the default.

**Staging is covered by that rule.** `docker-compose.staging.yml:17` sets
`NODE_ENV=production` (the `NODE_ENV` enum has no `staging` member), so staging must
configure a real driver and real Usapp credentials. Accepted consequence: on staging, only
phone numbers holding a registered Usapp account can complete activation — seeded demo
learners with placeholder numbers cannot. The bootstrap central admin is created `active`
with a password and never touches the OTP path, so administrative access to staging is
unaffected.

Implementation must not edit real `.env*` files — only the committed `.example` templates.

## 2. The port

`backend/src/platform/sms/` → `backend/src/platform/otp-delivery/`

```
otp-delivery.port.ts    OTP_DELIVERY_PORT, OtpDeliveryPort, three error classes
mock.driver.ts          logs the code (behavior unchanged)
http-sms.driver.ts      generic SMS gateway (behavior unchanged, error type changes)
usapp.driver.ts         new
```

```ts
export const OTP_DELIVERY_PORT = Symbol("OTP_DELIVERY_PORT");

export class RecipientNotRegisteredError extends Error {}
export class DeliveryRateLimitedError extends Error {}
export class DeliveryUnavailableError extends Error {}

export interface OtpDeliveryPort {
  /** Sends `message` to `phone` (E.164). Throws one of the three errors above. */
  send(phone: string, message: string): Promise<void>;
}
```

`HttpSmsDriver` stops throwing Nest's `BadGatewayException` and throws
`DeliveryUnavailableError` instead. The platform layer no longer imports HTTP exceptions
or owns student-facing copy, which also makes drivers unit-testable without Nest.

`platform.module.ts` switches its `OTP_DELIVERY_PORT` factory on `OTP_DELIVERY_DRIVER`.

## 3. The Usapp driver

```ts
POST `${USAPP_BASE_URL}/api/v1/messages/send`
headers: { "content-type": "application/json", "x-api-key": USAPP_API_KEY }
body:    { recipientPhone: phone, content: message, format: "plain" }
signal:  AbortSignal.timeout(USAPP_TIMEOUT_MS)
```

### Status mapping

| Usapp response | Driver throws | Meaning |
|---|---|---|
| `201` | — | delivered |
| `404` | `RecipientNotRegisteredError` | phone has no Usapp account |
| `429` | `DeliveryRateLimitedError` | per-second or per-minute tenant limit |
| `401`, `403` | `DeliveryUnavailableError` | **misconfiguration** — bad/revoked/expired key, inactive tenant, or LMS egress IP absent from the tenant's `ipAllowlist` |
| `400`, `5xx`, network, timeout | `DeliveryUnavailableError` | upstream fault |

`401` and `403` additionally emit a distinct `logger.error` naming the likely cause. They
are silent-until-someone-complains failures, and a generic "delivery failed" line buries
them.

### Logging

The driver logs `maskPhone(phone)` and **never logs `message`** — it contains the live OTP
code. (The mock driver logs it deliberately; that is its entire purpose.)

### Retries

None. The call is user-triggered and rate-limited on both sides. Retrying a `429` deepens
the hole; retrying a timeout risks delivering two codes when the first request landed.

## 4. Reordering `requestActivation`

`auth.service.ts` currently consumes the old OTP, writes a new one, *then* sends. A `404`
from Usapp therefore destroys a code the student may still be holding and stores a dead
one. Inverted:

```
enforceRateLimit(ip)
user ← findUserByEmail          guard: pending_activation && phone
enforceRateLimit(user)
code ← randomInt
await delivery.send(...)        throws before anything is persisted
await repo.replaceActivationOtp(...)
return { maskedPhone, expiresInSec, channel, devCode? }
```

`AuthRepository.replaceActivationOtp()` is new: it wraps `consumeActivationOtps` and
`createActivationOtp` in a single `$transaction`. Today those are two sequential statements
with no transaction, so a crash between them leaves the account with no valid code and no
record of why.

### Residual risk, accepted

If the send succeeds and the DB write then fails, the student receives a code that will not
verify, and their previous codes remain valid. This is strictly better than the current
failure mode, and the dominant failure is the network call — not a local write to a
database we just read the user from.

## 5. Channel-aware copy

The message body is already channel-neutral and does not change:

> `Resilient-Learn code: 042317 — use this to set your password. Valid 10 minutes.`

`ActivationRequestResponseSchema` gains `channel: z.enum(["usapp", "sms"])`, derived from
config (`mock` reports `"sms"`).

The step-1 CTA cannot know the channel — nothing has been requested yet — so it becomes the
neutral **"Send me the code"**. Everything after the request keys off `challenge.channel`,
out of a new block in `frontend/lib/copy.ts`:

| | `usapp` | `sms` (today's strings) |
|---|---|---|
| sent | "We sent a 6-digit code to your Usapp app on +63••••••1234." | "We texted a 6-digit code to …" |
| input hint | "Enter the 6 digits from your Usapp message." | "Enter the 6 digits from the text message." |
| mismatch | "That code didn't match — check your Usapp message and try again." | "…check the text message and try again." |

`frontend/app/activate/page.tsx` currently hardcodes "Text me the code", "We texted a
6-digit code to", and two "text message" strings. All four move into that table.

None of the new strings use `sync`, `server`, or `error`, per the microcopy rule in
`CLAUDE.md`.

## 6. HTTP error mapping

`auth.service` is the only place that knows status codes.

| Error | Status | Message |
|---|---|---|
| `RecipientNotRegisteredError` | `409` | "That number isn't on Usapp yet. Install Usapp, register this number, then request your code." |
| `DeliveryRateLimitedError` | `503` | "We're sending a lot of codes right now. Try again in a few minutes." |
| `DeliveryUnavailableError` | `502` | "We couldn't send your code right now — try again in a few minutes." |

The `409` string is owned by the backend, alongside the existing `CANNOT_ACTIVATE` and
`TOO_MANY_CODES` constants, and rendered by the frontend as-is. `copy.ts` therefore needs
no Usapp-only branch on step 1.

### Enumeration

The `409` is reachable only for an email belonging to a real, `pending_activation`,
phone-bearing user. That is the same disclosure the endpoint already makes by returning
`200` + `maskedPhone` for exactly those users and `404` otherwise. No new leak.

## 7. Testing

**The backend has zero tests and no test runner.** This change bootstraps one: **vitest**,
one devDep, no config file, works on Windows, drops into the turbo pipeline as `pnpm test`.

- `usapp.driver.spec.ts` — stub `global.fetch`. Assert the URL, the `x-api-key` header, and
  the body shape; assert every row of the §3 status table maps to the right error; assert
  the message body never reaches the logger and the phone is masked when it does.
- `auth.service.spec.ts` — when `send` throws `RecipientNotRegisteredError`, the service
  returns `409` **and `replaceActivationOtp` is never called.** That second assertion is the
  entire point of §4 and is the regression most worth pinning.
- `config.spec.ts` — `OTP_DELIVERY_DRIVER=usapp` with no `USAPP_API_KEY` fails to boot.
  Note that `loadConfig()` memoizes into a module-level `cached` binding, so each case must
  run against a fresh module (vitest `resetModules` / dynamic `import`) or the first parse
  wins for the whole file.

## Non-goals

- Usapp's batch API (`POST /api/v1/messages/batch`).
- Webhook delivery receipts.
- Usapp template provisioning and approval.
- Pre-checking Usapp registration at admin user-create or CSV-import time. The tenant API
  exposes no phone-lookup endpoint, so the only way to ask "is this number on Usapp?" is to
  send a message to it. Adding that check requires a new endpoint on the Usapp side.
- Tenant and API-key provisioning. Both already exist.
