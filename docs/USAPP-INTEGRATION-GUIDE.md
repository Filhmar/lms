# Integrating Usapp as an OTP / notification channel

A reference for any backend that needs to send one-time codes or notifications
through **Usapp** (`app.usapp.ph`) as a tenant of its Integration API. It is
written from a working NestJS integration but the pattern is framework-neutral —
the HTTP contract, the failure semantics, and the operational gotchas are the
transferable part.

> **Read this first, it is the whole trick:** Usapp's `POST /api/v1/messages/send`
> is **not an SMS gateway.** It resolves `recipientPhone` to a *registered Usapp
> account* and delivers an in-app message. A number with no Usapp account gets a
> **404**. Design around that, not around "send an SMS."

- [1. What Usapp gives a tenant](#1-what-usapp-gives-a-tenant)
- [2. One-time provisioning (admin side)](#2-one-time-provisioning-admin-side)
- [3. The only endpoint you need: send](#3-the-only-endpoint-you-need-send)
- [4. Environment variables](#4-environment-variables)
- [5. The integration pattern](#5-the-integration-pattern)
- [6. Reference driver (TypeScript)](#6-reference-driver-typescript)
- [7. Status-to-behavior mapping](#7-status-to-behavior-mapping)
- [8. Ordering rule: deliver before you persist](#8-ordering-rule-deliver-before-you-persist)
- [9. Security & operational checklist](#9-security--operational-checklist)
- [10. Failure runbook](#10-failure-runbook)
- [11. curl quickstart](#11-curl-quickstart)

---

## 1. What Usapp gives a tenant

You integrate as a **tenant**. An admin (Usapp side) registers your tenant and
issues you an **API key**. Every tenant request authenticates with that key in
the `X-API-Key` header — no OAuth, no JWT, no token refresh on the tenant path.

Four facts govern everything downstream:

| Fact | Consequence for you |
|---|---|
| Auth is `X-API-Key` header | one static secret, injected as an env var |
| **IP allowlist is mandatory** on the tenant | your server's egress IP (or CIDR) must be registered, or every call is `403` |
| Keys carry **scopes** | to send you need `messages:send`; a key with `scopes: []` is unrestricted |
| Plans set quota + rate | `INTERNAL` = unlimited monthly quota, 50 req/s, 1000 req/min, not billed |

The recipient must **hold a registered Usapp account.** For an OTP/verification
flow that is a feature: it makes "the user is reachable on Usapp" a precondition,
and Usapp — not your system — is the source of truth for who is registered. You
never mirror that state; you discover it from the send response.

There is **no phone-lookup endpoint.** The only way to learn "is this number on
Usapp?" is to send to it and read the status. So you cannot pre-validate
registration at signup or CSV-import time without spending a message.

## 2. One-time provisioning (admin side)

Done once per environment by whoever holds Usapp admin credentials. Your app
never calls these routes — it only ever holds the resulting key.

```bash
# 1. Admin login -> access token
TOKEN=$(curl -s "$USAPP/api/v1/admin/login" \
  -H 'content-type: application/json' \
  -d '{"username":"<admin>","password":"<pass>"}' | jq -r .accessToken)

# 2. Create the tenant. ipAllowlist is REQUIRED (>= 1 IPv4 or CIDR).
#    plan INTERNAL = unlimited + no rate-limit pain for internal systems.
TENANT=$(curl -s "$USAPP/api/v1/tenants" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
        "name": "my-system",
        "plan": "INTERNAL",
        "ipAllowlist": ["<your egress IP or CIDR>"]
      }' | jq -r .id)

# 3. Mint an API key scoped to sending. The raw key is shown ONCE.
curl -s "$USAPP/api/v1/tenants/$TENANT/api-keys" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"label":"my-system-backend","scopes":["messages:send"]}'
# -> { "rawKey": "….", … }   store rawKey as your USAPP_API_KEY secret
```

Scope minimally. If you only send codes, ask for `["messages:send"]` — not an
unrestricted key. Add `usage:read` only if you actually poll usage.

Updating the allowlist later is `PATCH /api/v1/tenants/{id}` with a non-empty
`ipAllowlist`.

## 3. The only endpoint you need: send

```
POST {USAPP_BASE_URL}/api/v1/messages/send
X-API-Key: <your raw key>
Content-Type: application/json

{
  "recipientPhone": "+639171234567",   // required, pattern ^\+63\d{10}$
  "content": "Your code is 042317. Valid 10 minutes.",
  "format": "plain"                    // "plain" | "markdown" (bold-only subset)
}
```

Alternatively use a pre-approved template instead of raw `content`:

```json
{ "recipientPhone": "+639171234567",
  "templateId": "<uuid>",
  "variables": { "code": "042317" } }
```

Provide **either** `content` **or** a valid `templateId` — not neither (that is
the documented `400`).

Responses (from the running Integration service):

| Status | Meaning |
|---|---|
| `201` | delivered to the recipient's Usapp app |
| `400` | neither `content` nor a valid `templateId` supplied |
| `401` | missing / invalid API key |
| `403` | caller IP not in the tenant allowlist, **or** key lacks `messages:send` |
| `404` | **recipient has no Usapp account** |
| `429` | per-second/-minute rate limit, or monthly quota exhausted |

> ⚠️ **The published OpenAPI (`docs/USAPP-API-DOCS.yaml`) omits the `404`.** It is
> real: the service throws `NotFoundException('Recipient not found')` when the
> phone resolves to no user. The spec file simply lacks the `@ApiResponse`
> decorator for it. **Handle 404 regardless of what the OpenAPI says.**

## 4. Environment variables

The API key is a secret. It lives in the environment, never in code, never in
git. Model it exactly like a database password.

```bash
# --- Usapp OTP delivery ---
USAPP_BASE_URL=https://app.usapp.ph   # origin only; the driver appends the path
USAPP_API_KEY=                        # the rawKey from provisioning — a SECRET
USAPP_TIMEOUT_MS=5000                 # a messaging call must never hang a request
```

Rules that keep this safe and portable:

1. **Commit a template, never the real file.** Ship `.env.example` with
   `USAPP_API_KEY=` empty; gitignore the real `.env*`. (`.gitignore`: `.env.*`
   plus a `!.env.*.example` negation.)
2. **Validate at boot, fail fast.** If the selected channel is `usapp`, make
   `USAPP_BASE_URL` and `USAPP_API_KEY` required — refuse to start without them.
   A half-configured process that boots and silently sends nothing is worse than
   one that won't boot.
3. **Never fall back to a no-op sender in production.** If your dev setup has a
   "log the code to the console" mode, guard it so it can never be the effective
   channel under `NODE_ENV=production`. A forgotten config that logs live codes
   to stdout and delivers none is a silent, total outage.

Boot-time validation, with Zod, looks like this (trimmed from the real config):

```ts
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OTP_DELIVERY_DRIVER: z.enum(["mock", "http", "usapp"]).default("mock"),
  USAPP_BASE_URL: optionalEnv(z.url().optional()),
  USAPP_API_KEY: optionalEnv(z.string().min(1).optional()),
  USAPP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
}).superRefine((env, ctx) => {
  // No silent no-op channel in production.
  if (env.NODE_ENV === "production" && env.OTP_DELIVERY_DRIVER === "mock") {
    ctx.addIssue({ code: "custom", path: ["OTP_DELIVERY_DRIVER"],
      message: "must not be `mock` in production — it logs codes and delivers none." });
  }
  // The chosen channel's credentials are required.
  if (env.OTP_DELIVERY_DRIVER === "usapp") {
    if (!env.USAPP_BASE_URL) ctx.addIssue({ code: "custom", path: ["USAPP_BASE_URL"], message: "required when OTP_DELIVERY_DRIVER=usapp" });
    if (!env.USAPP_API_KEY)  ctx.addIssue({ code: "custom", path: ["USAPP_API_KEY"],  message: "required when OTP_DELIVERY_DRIVER=usapp" });
  }
});
```

## 5. The integration pattern

Put Usapp behind a **port** (interface). Business logic depends on the interface;
Usapp is one swappable driver behind it. This is what lets you run a console
logger in dev, a plain SMS gateway on legacy numbers, and Usapp in production,
without any caller knowing which is live.

```
   caller (e.g. "send activation code")
        │  depends only on this interface
        ▼
   OtpDeliveryPort.send(phone, message)
        │  concrete driver chosen by config at boot
        ├── MockDriver     (dev: logs the code)
        ├── HttpSmsDriver  (a real SMS gateway)
        └── UsappDriver    (this guide)
```

**The driver must not know about HTTP status codes or user-facing copy.** It
translates transport outcomes into a small set of *domain* errors and throws
those. The caller (which owns the request/response and the microcopy) decides
what each domain error means for the user. This keeps the infrastructure layer
free of your web framework and trivially unit-testable.

```ts
export class RecipientNotRegisteredError extends Error {}  // Usapp 404
export class DeliveryRateLimitedError   extends Error {}   // Usapp 429
export class DeliveryUnavailableError   extends Error {}   // 401/403/400/5xx/timeout/network

export interface OtpDeliveryPort {
  /** Sends `message` to `phone` (E.164). Throws one of the three errors above. */
  send(phone: string, message: string): Promise<void>;
}
```

## 6. Reference driver (TypeScript)

The real driver, verbatim. It uses only `fetch` — no SDK, no dependency. Port it
to any language by keeping the three invariants noted in the comments.

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

@Injectable()
export class UsappDriver implements OtpDeliveryPort {
  private readonly logger = new Logger("UsappOtpDelivery");

  constructor(private readonly configService: ConfigService) {}

  async send(phone: string, message: string): Promise<void> {
    const { USAPP_BASE_URL, USAPP_API_KEY, USAPP_TIMEOUT_MS } = this.configService.config;
    const base = USAPP_BASE_URL!.replace(/\/+$/, "");   // tolerate a trailing slash

    let response: Response;
    try {
      response = await fetch(`${base}/api/v1/messages/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": USAPP_API_KEY!,
        },
        body: JSON.stringify({ recipientPhone: phone, content: message, format: "plain" }),
        signal: AbortSignal.timeout(USAPP_TIMEOUT_MS),   // never hang a request
      });
    } catch (err) {
      // Transport fault or timeout — the request may or may not have landed.
      this.logger.error(
        `Usapp unreachable for ${maskPhone(phone)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new DeliveryUnavailableError();
    }

    if (response.ok) return;

    // 404 = the number holds no Usapp account. Expected and user-actionable,
    // so it is NOT logged as an operational fault.
    if (response.status === 404) {
      throw new RecipientNotRegisteredError();
    }

    if (response.status === 429) {
      this.logger.warn(`Usapp rate-limited this tenant sending to ${maskPhone(phone)}`);
      throw new DeliveryRateLimitedError();
    }

    if (response.status === 401 || response.status === 403) {
      // Misconfiguration — name every operator-fixable cause, because a generic
      // "delivery failed" line buries the one thing someone can actually fix.
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

**Three invariants, whatever language you port to:**

1. **Never log `message`.** It carries the live OTP code. Log a *masked* phone
   (`+63••••••4567`) and nothing else identifying. Your logs are not a place for
   valid credentials.
2. **Never retry.** The call is user-triggered and rate-limited on both sides.
   Retrying a `429` deepens the hole; retrying a timeout can deliver *two* codes
   when the first request actually landed. Let the user press the button again.
3. **Always time out.** A messaging dependency that hangs must not hold an
   activation request open. 5s is generous.

## 7. Status-to-behavior mapping

The driver produces a domain error; the caller turns it into an HTTP response
and user copy. Keeping this table in one place (the caller) means the transport
layer never hard-codes what a failure "means."

| Usapp | Driver throws | Suggested HTTP | User-facing copy (example) |
|---|---|---|---|
| `201` | — (success) | `200`/`201` | proceed; tell them where to look ("check your Usapp app") |
| `404` | `RecipientNotRegisteredError` | `409 Conflict` | "That number isn't on Usapp yet. Install Usapp, register this number, then request your code." |
| `429` | `DeliveryRateLimitedError` | `503` | "We're sending a lot of codes right now. Try again in a few minutes." |
| `401/403/400/5xx/timeout` | `DeliveryUnavailableError` | `502` | "We couldn't send your code right now — try again in a few minutes." |

Caller side:

```ts
try {
  await this.delivery.send(phone, `Your code is ${code}. Valid 10 minutes.`);
} catch (err) {
  if (err instanceof RecipientNotRegisteredError) throw new ConflictException(NOT_ON_USAPP);
  if (err instanceof DeliveryRateLimitedError)    throw new ServiceUnavailableException(BUSY);
  if (err instanceof DeliveryUnavailableError)    throw new BadGatewayException(FAILED);
  throw err;   // anything unexpected surfaces, not masqueraded as one of the above
}
```

Because `404` (not on Usapp) is only reachable for a real, eligible account, it
discloses nothing your endpoint doesn't already disclose. If your flow must avoid
account enumeration, confirm the `409` isn't reachable for arbitrary inputs.

## 8. Ordering rule: deliver before you persist

The subtle correctness point, and the reason this integration is more than "call
an API." If your flow stores the code (to verify it later), **send it first, and
persist only after Usapp accepts it.**

```
generate code
   └─ send via Usapp  ──►  throws on 404/429/5xx  ──►  return the error, persist NOTHING
   └─ (only on success) supersede old code + store new one, atomically
```

Why: the natural order — supersede the old code, write the new one, then send —
means a failed send has already destroyed a code the user may still be holding
and stored a dead one they'll never receive. With Usapp, `404` is a *routine*
outcome, not a rare fault, so this bug fires constantly. Inverting the order
means a failed delivery leaves the previously-issued code valid.

Make the supersede-and-issue a **single transaction**, so a crash between them
can't leave the account with no valid code:

```ts
async replaceActivationOtp(input): Promise<void> {
  await this.prisma.$transaction([
    this.prisma.otpRequest.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } }),
    this.prisma.otpRequest.create({ data: { ...input } }),
  ]);
}
```

Residual, accepted risk: send succeeds, then the DB write fails — the user gets a
code that won't verify while their old codes stay valid. Strictly safer than the
inverse, and rare (the network call is what breaks, not a local write).

## 9. Security & operational checklist

- [ ] `USAPP_API_KEY` is a secret: env var / secret store only, never in git, never logged.
- [ ] Committed only the `.env.example` template with an **empty** key value.
- [ ] Key scoped to the minimum (`messages:send` for a pure sender).
- [ ] Your server's **egress IP (or CIDR) is in the tenant `ipAllowlist`** — the single most common first-deploy failure.
- [ ] Boot **fails fast** if `usapp` is selected without `USAPP_BASE_URL` + `USAPP_API_KEY`.
- [ ] No no-op/mock sender can be the live channel in production.
- [ ] Driver **times out** every request and **never retries**.
- [ ] Logs carry a **masked** phone and **never** the message body / code.
- [ ] Codes are stored **hashed** (e.g. SHA-256), compared in constant time, single-use, short TTL, attempt-capped.
- [ ] Request endpoint is rate-limited per-IP and per-user independently of Usapp's own limits.
- [ ] Key rotation path known: mint a new key, swap the secret, revoke the old (`DELETE /api/v1/tenants/{tenantId}/api-keys/{keyId}`).

## 10. Failure runbook

| Symptom | Almost always | Fix |
|---|---|---|
| **Every** send `403` | egress IP not in the allowlist, or key missing `messages:send` | `PATCH /tenants/{id}` to add the IP/CIDR; re-mint the key with the scope |
| All sends `401` | wrong / revoked / expired key | rotate; confirm the secret in the environment matches the minted key |
| A specific number `404` | that number has no Usapp account (working as designed) | tell the user to register on Usapp first |
| Bursts of `429` | above plan rate/quota | back off (don't retry); raise the plan, or move to `INTERNAL` |
| Occasional `502`/timeout | transient upstream/network | user retries; check `USAPP_TIMEOUT_MS` and Usapp status |
| Boots but delivers nothing | wrong channel selected (e.g. a mock/log driver) or missing creds swallowed | the boot-time fail-fast in §4 exists to prevent exactly this |

The `401/403` log line naming the allowlist and key is deliberate: these are the
"silent until someone complains" failures, and a generic "delivery failed"
buries the one thing an operator can act on.

## 11. curl quickstart

```bash
export USAPP=https://app.usapp.ph
export KEY=<your raw api key>

# happy path — 201 if the recipient is a registered Usapp user
curl -i "$USAPP/api/v1/messages/send" \
  -H "X-API-Key: $KEY" -H 'content-type: application/json' \
  -d '{"recipientPhone":"+639171234567","content":"Your code is 042317. Valid 10 minutes.","format":"plain"}'

# 404 if the number has no Usapp account
curl -i "$USAPP/api/v1/messages/send" \
  -H "X-API-Key: $KEY" -H 'content-type: application/json' \
  -d '{"recipientPhone":"+639990000000","content":"test","format":"plain"}'

# optional: your own usage (needs the usage:read scope)
curl -s "$USAPP/api/v1/usage" -H "X-API-Key: $KEY" | jq .
```

If the happy-path call returns `403` from your server but `201` from your laptop,
it is the allowlist — your server's egress IP differs from your laptop's.

---

*Companion documents: the machine-readable contract lives in
[`USAPP-API-DOCS.yaml`](./USAPP-API-DOCS.yaml) / [`.json`](./USAPP-API-DOCS.json)
(note the missing-404 caveat in §3). This project's own design rationale and the
send-before-persist decision are in
[`superpowers/specs/2026-07-09-usapp-otp-delivery-design.md`](./superpowers/specs/2026-07-09-usapp-otp-delivery-design.md).*
