# Resilient-Learn — Tech Stack Assessment & Decision

> **Status:** Approved planning baseline (pre-implementation). Produced July 2026 from
> (a) the PRD at [docs/plan.md](plan.md), (b) the prior-project backend blueprint
> (Usapp `STACK.md`, NestJS 11 TCP-microservices monorepo), and (c) a verification pass
> against current browser/platform/framework reality (MDN browser-compat-data, WebKit,
> 1EdTech, vendor docs — all findings sourced). Three candidate architectures were
> drafted independently and scored; this document records the winner, what it borrows
> from the runners-up, and the corrections the PRD itself needs.

---

## 1. Repository assessment

The repo is pre-implementation: `docs/plan.md` (the full PRD), `CLAUDE.md` (a distilled
guide), and empty `README.md`/`.gitignore`. There is no application code, so the stack
decision is unconstrained by legacy — but strongly constrained by the PRD's physics:
offline-first PWA, client-is-source-of-truth exams, national-scale concurrency on
low-end Android over 2G/3G, and Annex A portability (Azure ↔ AWS ↔ GCP ↔ on-prem).

## 2. Verdict at a glance

**Modular monolith hybrid in a Turborepo — Next.js PWA frontend + ONE NestJS modular
API + BullMQ worker + standalone verify service, on PostgreSQL only.**

| Layer | Choice | Why (one line) |
|---|---|---|
| Monorepo | **Turborepo + pnpm workspaces**, strict TS | Affected-only CI, one lockfile, shared packages between SW/client/server |
| Frontend | **Next.js 16 + TypeScript + React 19**, Tailwind CSS | Honors your preference; learner surface is a fully client-rendered precached shell (see §5.2 constraints) |
| Service worker | **Serwist** (`@serwist/next`, injectManifest) | Maintained Workbox successor; the one named in the official Next.js PWA guide. Raw Workbox/next-pwa are stagnant/dead |
| Local store | **IndexedDB via `idb`**, repository pattern in a shared package | Per PRD; repositories behind a StoragePort = the mobile hedge |
| Client state | **TanStack Query + IndexedDB persister** | Cleanest realization of the PRD's local-first read path |
| API | **NestJS 11 modular monolith** (Node 24 LTS, Express adapter) | Your team's muscle memory; modules = bounded contexts, split-later seams CI-enforced |
| Worker | **BullMQ** (`@nestjs/bullmq`) on Redis/Valkey | Zero new infra (Redis already required); jobs table in Postgres is source of truth |
| Verify service | Tiny standalone **Fastify/Nest-Fastify** read-only app (Phase IV) | PRD-mandated isolation; deployable on a potato, scale-to-zero |
| Database | **PostgreSQL 16 only** (closure table + partitioned LWW tables + JSONB) | One engine to operate nationally; sync merge is a single atomic upsert. **No MongoDB** |
| ORM | **Prisma 7** (+ shared `pg.Pool` for raw SQL & COPY) | Prisma 7 requires a pg driver adapter anyway — same pool serves ORM, closure-table SQL, `pg-copy-streams` |
| Cache/queue | **Redis 7 / Valkey** | Cache, rate limits, BullMQ, Redis Streams pressure valve |
| Object storage | S3-compatible behind a **~5-method ObjectStorage port** (`@aws-sdk/client-s3` + `@azure/storage-blob` drivers) | Azure Blob is *not* S3-compatible — the port, not wishful thinking, keeps Annex A true |
| Auth | Stateless JWT, **RS256/ES256 + JWKS** (not HMAC) | Satellite services verify without shared secrets; rotation = publish, not redeploy |
| Client crypto | **Envelope encryption**: AES-GCM data key wrapped with per-exam RSA-OAEP public key (Web Crypto `wrapKey`) | Direct RSA-OAEP caps at 190 B (2048-bit) — free-text answers would throw. See §3 |
| Credential signing | **Ed25519 Data Integrity proofs** (`eddsa-rdfc-2022`), optional RS256 VC-JWT dual proof | RSA-PSS fails Open Badges 3.0 conformance. See §3 |
| Video | HLS segments in IndexedDB via **hls.js custom loaders / Shaka Player offline** | The PRD's blob-URL-of-m3u8 sketch does not play on Android. See §3 |
| Observability | **OpenTelemetry** (traces+metrics) → OTLP Collector; pino/Winston logs; SW heartbeat as plain JSON ingest | Collector is the Annex A portability hinge; browser OTel is still experimental |
| Deploy | Plain OCI containers on **Azure Container Apps** (KEDA), one multi-stage Dockerfile, Trivy+cosign CI, digest-pinned | Blueprint's delivery discipline, kept cloud-portable |
| Mobile future | PWA → TWA (Bubblewrap, Play Store) → **Expo React Native** in the same monorepo reusing `packages/*` | Sync engine/LWW/crypto/contracts are ported, not rewritten |

Judge scores (weighted toward offline-first fit and small-team manageability):

| Proposal | Score | One-line verdict |
|---|---|---|
| **Modular monolith hybrid (winner)** | **8.7** | Fewest moving parts that still scales horizontally; only design that already handles the iOS sync gap |
| Next.js full-stack (route handlers as the API) | 7.5 | Fastest MVP, but couples exam-day sync ingestion to the rendering tier and strands your NestJS depth |
| Usapp blueprint replica (TCP microservices + Mongo) | 5.4 | ~9 deployables + 3 datastores for a small team; its weight sits exactly where this project's risk is *not* |

## 3. Critical corrections to the PRD (verified)

These findings change design decisions. Each was verified against primary sources
(MDN browser-compat-data, WebKit blog, RFC 8017, 1EdTech spec, vendor docs).

| # | PRD claim | Verified status | What to build instead |
|---|---|---|---|
| 1 | Background Sync API "managed by the OS (Android/Windows/**iOS**)"; retries "even if the user has closed the tab" | **Refuted for iOS.** Safari/WebKit has never shipped Background Sync (through Safari 26); Firefox lacks it too. Chromium-only (~78% global) | Build the sync engine as a portable IndexedDB **outbox** with three trigger layers: `registration.sync` (Android Chrome), SW replay-on-startup (Serwist fallback), and app-level triggers (`online` event, `visibilitychange`, ~30 s in-exam interval). **Android Chrome is the reference platform; iOS is a documented degraded mode** — data survives, drip-after-close does not. Use Web Push (iOS 16.4+, installed PWA only) as the "reopen to finish uploading" nudge; teachers verify sync status before students leave |
| 2 | Safari's 7-day storage eviction threatens offline data | **Refuted for installed PWAs.** Home-screen web apps are exempt; `navigator.storage.persist()` (iOS 15.2+) exempts the origin from eviction; quotas are ample (up to ~60% of disk) | Make **add-to-home-screen a first-class onboarding step** and call `navigator.storage.persist()` at first login. Note: the installed iOS app has a *separate* store from the Safari tab — hydrate after install |
| 3 | Per-answer direct RSA-OAEP encryption (EncryptionService sketch) | **Partial.** RSA-OAEP/SHA-256 caps plaintext at **190 bytes** (2048-bit) / 446 bytes (4096-bit) — Identification free-text + JSON metadata will throw `OperationError` | One primitive everywhere: **envelope encryption** — per-attempt AES-GCM data key encrypts payloads; the key is wrapped with the versioned per-exam RSA-OAEP public key via `crypto.subtle.wrapKey`. Private keys never leave KMS/Vault; decryption only in the grading worker |
| 4 | Credentials signed with **RSA-PSS** | **Refuted.** Open Badges 3.0 permits exactly two proof formats: VC-JWT (RS256 minimum) and W3C Data Integrity with the **Ed25519** `eddsa` cryptosuite. RSA-PSS appears nowhere and fails 1EdTech conformance | Sign with **Ed25519** (`eddsa-rdfc-2022`), optionally dual-proof with an RS256 VC-JWT for wallet compatibility. Bonus: 64-byte signatures keep QR payloads small; Node supports Ed25519 natively |
| 5 | Offline video: `URL.createObjectURL(blob)` of stored HLS content | **Refuted for Android.** Chrome has no reliable native HLS; hls.js requires MSE — a blob URL of an m3u8 cannot resolve segment URIs. Also: on iPhone, native HLS goes through AVFoundation and **bypasses the service worker entirely** | Store per-segment blobs in IndexedDB (resumable on 3G); play via **hls.js custom `pLoader`/`fLoader`** or SW interception — or adopt **Shaka Player**, which ships production IndexedDB offline storage. On iOS 17.1+ use ManagedMediaSource so segment fetches pass through the SW; whole-file MP4 blob as the fallback for older iOS. Skip DRM persistent licenses (unsupported offline on Android) — app-level encrypted blobs stand |
| 6 | `navigator.connection` drives adaptive prefetch | **Refuted as universal.** Chromium-only; absent on 100% of iOS browsers and removed from Firefox | Wrap in a **NetworkProfile module**: `effectiveType`/`saveData` on Chromium; measured-throughput of real fetches or a conservative 3G default elsewhere. Also honor the `Save-Data` client hint server-side |
| 7 | Workbox as the SW toolkit | **Partial.** Workbox is alive (v7.4.1, May 2026) but stagnant since the 2023 handover — the stated reason Serwist forked it. The official Next.js guide names only Serwist | Use **Serwist** (`@serwist/next` on web; `@serwist/background-sync` replaces `BackgroundSyncPlugin`). Budget the Turbopack seam: Next 16 defaults to Turbopack, which doesn't run webpack plugins — use `@serwist/turbopack` or build production with webpack, and pin versions |
| 8 | Annex A on-prem jobs row: "RabbitMQ / Celery" | Outdated for this stack | Amend to **Redis/Valkey + BullMQ** — every worker is Node, Redis is already mandated, and BullMQ tests against Valkey (BSD) for a strict-OSS on-prem mandate |
| 9 | Closure table is "O(1) vs Moodle's O(N)" | Marketing-level framing | Keep the closure table (single index-scan joins, no `ltree` extension dependency — better on-prem portability), but the honest claim is "single index-scan join vs recursive iteration"; at 5 fixed levels a recursive CTE is also milliseconds. The <50 ms SLO is trivially achievable either way |

**None of these findings argue against Next.js, NestJS, or TypeScript** — they are
browser/platform constraints independent of framework. But they demand an explicit
`platform capabilities` abstraction in the PWA (sync-trigger strategy, video pipeline,
network profile) selected by feature detection.

## 4. Options considered

### Option A — Replicate the Usapp blueprint (TCP microservices + polyglot persistence)

Your `STACK.md` architecture mapped onto LMS domains: api-gateway + auth + org +
courses + cbt-sync + credentials + provisioning as TCP microservices; Postgres + Mongo
+ Redis + MinIO.

- **For:** proven at national-messaging scale; team knows every pattern; best-articulated
  future-mobile story (the gateway was built for a mobile client); process isolation.
- **Against (decisive):** ~9 always-on deployables + 3 datastores for a small team, years
  before Phase IV load justifies the isolation. Every Phase I feature crosses a TCP
  contract; NestJS TCP transport is unencrypted/unauthenticated, degrades KEDA
  autoscaling, and blocks scale-to-zero. MongoDB would split the highest-integrity data
  (encrypted answers) from ACID attempt state — structurally reintroducing the
  "finished exam with missing answers" failure the PRD exists to eliminate. And the
  architecture's weight sits in the backend, while this project's real risk is the
  offline frontend.

### Option B — Next.js full-stack (route handlers as the entire API)

One Next.js codebase: PWA + API routes + server actions, plus a small worker.

- **For:** fastest credible MVP; one deploy; end-to-end types; its frontend stance
  (learner surfaces as client components fed only by `/api/v1`) is exactly what the
  research says Next.js offline requires.
- **Against (decisive):** couples exam-day sync ingestion to the SSR/rendering tier —
  the concession in its own risk list is a mid-flight extraction of a sync API if p99
  degrades, precisely the surgery you don't want during a national rollout. Strands
  the team's NestJS depth (DI, guards, queues become hand-rolled conventions that
  "erode under deadline pressure"). Server Actions don't work under static export and
  can't serve a future native mobile client.

### Option C — Modular monolith hybrid ✅ **(chosen)**

Four deployables in one Turborepo. All offline intelligence in shared packages with
exactly one definition, consumed identically by the service worker, the React client,
and the server.

- **Why it wins:** best on the two highest-weighted criteria. *Offline fit:* the only
  proposal that designs for the verified iOS gap up front and mandates offline E2E
  tests (Playwright with network kill) in CI. *Manageability:* four deployables, one
  database engine, one backup/HA story, and NestJS is home turf. *Concurrency:*
  stateless JWT + zero inter-service hops on the hot path; the LWW merge is one
  idempotent SQL statement; module seams are CI-enforced so extracting `cbt-sync`
  later is a refactor, not a rewrite.

## 5. The recommended architecture

### 5.1 Topology

```
                                   ┌─────────────────────────────────────────────┐
 Learner PWA (offline-first) ────▶ │  apps/web   Next.js 16 (containerized)      │
 Admin console / public pages ──▶  │  learner shell = client-rendered, precached │
                                   └──────────────┬──────────────────────────────┘
                                                  │ HTTPS /api/v1 (REST, OpenAPI)
                                   ┌──────────────▼──────────────────────────────┐
                                   │  apps/api   NestJS 11 modular monolith      │
                                   │  modules: auth · org-hierarchy · courses ·  │
                                   │  cbt-sync · credentials · provisioning      │
                                   │  (CI-enforced seams, schema-per-module)     │
                                   └───┬──────────────┬───────────────┬──────────┘
                                       │              │               │ BullMQ
                            ┌──────────▼───┐   ┌──────▼─────┐  ┌──────▼──────────┐
                            │ PostgreSQL 16 │   │ Redis /    │  │ apps/worker     │
                            │ closure table │   │ Valkey     │  │ csv-import ·    │
                            │ LWW partitions│   │ cache/rate/│  │ grading/decrypt │
                            │ JSONB · jobs  │   │ queues/    │  │ hls-packaging · │
                            └──────────────┘   │ streams    │  │ credential-issue│
                                               └────────────┘  └─────────────────┘
   S3-compatible object storage (MinIO / Azure Blob / S3 behind ObjectStorage port)
   CDN + signed URLs for course assets & HLS segments (API never proxies bytes)

   apps/verify (Phase IV) — standalone read-only credential verifier
   own read-model table · Ed25519 verify · Redis cache · CDN-fronted · scale-to-zero
```

### 5.2 Frontend rules that make Next.js safe for offline

Next.js has **no built-in offline support**, and RSC/SSR payloads are unavailable when
the server is unreachable. The learner surface therefore follows hard rules:

1. **Client-rendered app shell only.** The course player, CBT engine, download
   manager, and sync surfaces are `'use client'` islands that boot from the precached
   shell with zero network. No RSC data dependencies, no Server Actions, no
   middleware-gated routes in any offline-critical path — enforced with an ESLint ban
   on the learner route group, plus **Playwright offline E2E tests in CI** (network
   kill → app must still take an exam).
2. **SSR/RSC used freely only on online surfaces** — login, admin console, and the
   public verification page, where SEO/streaming genuinely help.
3. **Serwist injectManifest** (custom SW): precached shell; Stale-While-Revalidate for
   assets; Network-First-with-IndexedDB-fallback for `/api/v1/*` (intercept 5xx/timeout,
   answer from the local store per the PRD); outbox drip queue; HLS segment
   interception.
4. **All learner data flows client-side**: TanStack Query + IndexedDB persister over
   repositories in `packages/offline-store`. The server is an aggregator, not a renderer.
5. **The 3-second rule is a failing build, not a guideline** — CI-enforced bundle
   budget for the learner shell; web-vitals (LCP/INP) reported from 3G-class devices
   into telemetry.

### 5.3 Data layer — why Postgres-only is a conviction, not a compromise

The only workload that looks document-shaped is the sync event stream, and it's
precisely the workload Postgres wins. Answer events are tiny fixed tuples; the entire
CRDT (LWW-Element-Set) merge is **one atomic, idempotent, order-independent statement**:

```sql
INSERT INTO cbt.answers (attempt_id, question_id, ciphertext, client_ts, received_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (attempt_id, question_id) DO UPDATE
  SET ciphertext = excluded.ciphertext, client_ts = excluded.client_ts,
      received_at = excluded.received_at
  WHERE excluded.client_ts > cbt.answers.client_ts;
```

Merged answers and attempt status commit **in the same transaction** — a polyglot
Mongo/Postgres split structurally cannot give you that, and the bug class it prevents
("I submitted but it didn't save") is the exact trust-killer this project exists to fix.

- **LWW hardening (graft from Option A):** a student's clock is attacker-controlled in
  a high-stakes exam. Store server-stamped `received_at` alongside `client_ts`, bound
  timestamps to the per-attempt exam window, and treat `client_ts` as advisory within
  the server-validated window.
- **Scale valve:** partition `cbt.answers` by exam window (archive to object storage
  after grading); PgBouncer transaction pooling; `/sync/batch` uses a prepared raw
  upsert on the shared `pg.Pool`; when Postgres latency crosses a threshold the
  endpoint flips to enqueue-mode (Redis Streams → worker drains the same idempotent
  upsert), so the two paths can never disagree.
- **Flexible shapes** (course manifests, `metadata_snapshot`, IRT metadata): JSONB with
  GIN indexes.
- **Bulk import:** stream CSV from object storage → sanitize → `COPY` via
  `pg-copy-streams` into an UNLOGGED staging table → set-based validated insert.
  Neither Prisma nor Drizzle does COPY natively; this is raw-driver code by design.
- **Jobs:** BullMQ for transport, but a **Postgres `jobs` table is the source of truth**
  for job state (graft from Option B) — a Redis failover during exam season must not
  lose CSV-import or grading state.

### 5.4 Monorepo layout

```
resilient-learn/
├── apps/
│   ├── web/          # Next.js 16 PWA — learner shell (client-rendered) + admin (SSR ok)
│   ├── api/          # NestJS 11 modular monolith
│   │   └── src/modules/{auth,org-hierarchy,courses,cbt-sync,credentials,provisioning}/
│   │       # each: controller/ service/ repository/ + module-public index.ts contract
│   ├── worker/       # NestJS standalone ctx: BullMQ processors
│   │   └── {csv-import,grading,credential-issuance,hls-packaging,sync-drain,notifications}
│   └── verify/       # Phase IV: read-only Fastify verifier (~300 lines, zero apps/api imports)
├── packages/
│   ├── schemas/          # Zod DTOs — single source of truth → OpenAPI + typed client
│   ├── sync-protocol/    # LWW event envelope, batch format, idempotency keys, versioning
│   ├── offline-store/    # IndexedDB repositories behind StoragePort/QueuePort (mobile hedge)
│   ├── crypto/           # envelope encrypt (client) · KMS KeyProvider port · Ed25519 sign/verify
│   ├── prefetch/         # NetworkProfile + priority-queue adaptive prefetch engine
│   ├── api-client/       # typed fetch client generated from schemas (RN-compatible)
│   ├── db/               # Prisma schemas per bounded context (one PG, schema-per-module)
│   ├── storage/          # ObjectStorage port + S3/Azure Blob drivers
│   ├── config/           # Zod env schema + typed accessor (blueprint pattern, per-app subschemas)
│   ├── observability/    # OTel setup, logging, correlation-ID = W3C traceparent
│   └── ui/               # shared React components/tokens
└── tooling/              # eslint-config, tsconfig, dependency-cruiser rules
```

Three rules make "modular" real rather than aspirational (CI fails on violation):
modules import only each other's published `index.ts` (dependency-cruiser/
eslint-boundaries); each module owns its own Prisma schema targeting its own Postgres
schema (`auth.*`, `org.*`, `cbt.*` … — fully qualify raw SQL, the blueprint's hard-won
lesson); no module reads another module's tables. Cross-module side effects go through
domain events with a transactional outbox table. Consequence: extracting `cbt-sync`
into its own service in Phase IV is "move folder, point at same schema, swap the event
bus" — the documented escape hatch if national exam load ever exceeds a single writer.

### 5.5 Auth & crypto

- **Stateless JWT** exactly as the PRD demands, upgraded to asymmetric signing
  (RS256/ES256) with a **JWKS endpoint** so `verify`, the worker, and any future
  split-out service validate tokens without shared secrets. Access 15 min
  `{sub, role, scope_id, token_version}`; refresh 7 days, rotating with reuse
  detection, stored hashed — the only stateful auth artifact. Argon2id for passwords;
  bulk-imported users land `pending_activation` with no password. Emergency revocation
  via a bounded-TTL Redis denylist checked only on sensitive routes — never a session
  table.
- **Scope authorization:** a guard resolves the JWT's `scope_id` to ancestor/descendant
  sets via the closure table with a Redis cache keyed by a scope-version stamp —
  downward inheritance + lateral isolation as a WHERE-clause join.
- **Exam crypto:** per-exam RSA-OAEP keypairs generated in and never leaving KMS
  (Azure Key Vault now; AWS/GCP KMS or Vault behind the `KeyProvider` port). PWA
  fetches the versioned public key with the exam manifest; envelope-encrypts client-side
  before anything touches IndexedDB; the grading worker decrypts via KMS.
- **Credentials:** SHA-256 assertion hash + **Ed25519** Data Integrity proof
  (`eddsa-rdfc-2022`), `key_version` recorded in every assertion; append-only
  `issued_credentials` + a denormalized read-model row published for `apps/verify`.

### 5.6 Observability & deploy

- **OTel traces + metrics** (stable) in api/worker/verify → OTLP → Collector (Azure
  Monitor today, Grafana Tempo/Loki/Mimir on-prem — config change only). Logs via
  pino/Winston bridge (OTel logs SDK is still "Development" status). Correlation ID
  **is** the W3C `traceparent`, so one ID follows a request SW → API → outbox → worker
  → Postgres.
- **SW "sync heartbeat"** = plain JSON beacons to an ingest endpoint, translated to
  OTel server-side (browser OTel is explicitly experimental) → the national
  connectivity-failure map, tagged by scope for "Region VIII sync failures" dashboards.
- Domain metrics: sync-batch lag & merge-conflict rate per region, LWW rejected-event
  count, queue depth/age, closure-query p99 vs the 50 ms SLO, KMS decrypt latency.
  Alerts are SLO burn-rate, not raw thresholds.
- **Delivery (blueprint discipline, adopted wholesale):** one multi-stage Dockerfile →
  four slim non-root OCI images; Trivy scan gate + SBOM + cosign sign; deploy by signed
  digest; smoke test + rollback; staging auto, production manual-gated.
  **Migrations run as a pre-deploy job — never in container CMD** (that habit doesn't
  survive 30 replicas racing `migrate deploy`).
- **Scaling:** ACA/KEDA — api on HTTP concurrency with `minReplicas ≥ 1` during school
  hours **plus scheduled pre-scaling before announced exam windows** (reactive
  autoscaling lags a 9:00 AM synchronized start; multi-second cold starts are
  unacceptable mid-sync); scale-to-zero reserved for verify and workers. SSE (not
  socket.io) for job progress — real-time is not the product here.
- **k6 load-test harness** (graft from your blueprint): seeded 50k-school closure-table
  dataset; sync-ingest path at **3× projected national-exam peak before Phase II ships**.

## 6. Reuse from the Usapp `STACK.md` blueprint

| Verdict | Items |
|---|---|
| **Adopt wholesale** | Zod config schema + typed accessor (fail-fast boot); Winston/pino structured logging + nestjs-cls correlation IDs; Trivy+SBOM+cosign+digest-pinned deploys with smoke/rollback; Helmet profile, global ValidationPipe posture, throttler, trust-proxy; Redis-locked cron rule; npm `overrides` CVE discipline; SOPS/age-encrypted env for on-prem; repository-pattern layering; "no localhost defaults in containers" |
| **Adapt** | Single multi-stage Dockerfile → pnpm + `turbo prune`, four runtime targets; Prisma-per-schema → per-*module* schemas in ONE database (preserves the split path); JWT machinery → asymmetric + JWKS; prom-client `/metrics` kept alongside OTLP for Prometheus-native on-prem; FCM/Web Push plumbing adopted **early** as the iOS sync-nudge channel; sharp/libvips derivatives in the worker for the 3G thumbnail tiers |
| **Reject** | TCP microservices topology (network hops + distributed debugging tax with no requirement behind it); MongoDB/Mongoose (see §5.3); socket.io gateway (SSE suffices; realtime was Usapp's product, not this one) |

## 7. Key decisions (binding)

1. **Topology:** one NestJS 11 modular monolith + worker + verify + web. Extraction of
   `cbt-sync` is the documented Phase IV escape hatch, made cheap by CI-enforced seams.
2. **Sync engine:** portable IndexedDB outbox in `packages/sync-protocol`; Background
   Sync API is a Chromium progressive enhancement, **not** the foundation; iOS is a
   documented degraded mode with honest UX ("Saved on device — open when online") and
   push nudges. Scope the PRD's "even after the tab is closed" claim to Android.
3. **Frontend:** Next.js 16, learner surface = client-rendered precached shell via
   Serwist injectManifest; ESLint bans + offline E2E in CI; add-to-home-screen as
   first-class onboarding; `navigator.storage.persist()` at first login.
4. **Client crypto:** envelope encryption (AES-GCM + RSA-OAEP `wrapKey`) as the single
   primitive; keys live in KMS; decryption only in the worker.
5. **Credentials:** Ed25519 Data Integrity proofs per Open Badges 3.0 conformance —
   not RSA-PSS. Correct plan.md/CLAUDE.md accordingly.
6. **Video:** per-segment IndexedDB blobs + hls.js custom loaders or Shaka offline;
   ManagedMediaSource on iOS 17.1+; no offline DRM. Prefetch behind a NetworkProfile
   module (never assume `navigator.connection`).
7. **Data:** PostgreSQL 16 only; closure table stays; LWW = single atomic upsert with
   server-clock hardening on partitioned tables; Redis/Valkey + BullMQ (amend Annex A);
   Postgres jobs table as job-state source of truth.
8. **Deploy/observability:** plain OCI + KEDA, scheduled pre-scaling for exam windows,
   migrations as pre-deploy jobs, OTel → Collector as the portability hinge, ObjectStorage
   port with real S3 *and* Azure Blob drivers.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Module-boundary erosion (the existential modular-monolith risk) | dependency-cruiser + eslint-boundaries failing CI from commit #1; module-public-index contracts; schema-per-module ownership; review culture treats violations as build breaks |
| Next.js App Router vs offline-first tension (Serwist is community-maintained; a stray server dependency breaks offline invisibly) | ESLint route-group bans; Playwright offline E2E as a required check; pin Next/Serwist versions; budget the Turbopack/webpack seam. **Fallback documented in §10** |
| Single-writer Postgres ceiling on synchronized national exam mornings | Partitioning + batched upserts + PgBouncer; Redis Streams pressure valve pre-built; k6 at 3× peak before Phase II; escalation path = extract `cbt-sync` (Citus/sharding as the further step) |
| One API deployable = one blast radius | Blue-green/canary on ACA revisions — non-negotiable during exam windows; verify is isolated by design |
| iOS degraded sync + storage pressure on 16–32 GB Androids | Outbox triggers + push nudges + proctor verification (see §3.1); `persist()` + `estimate()` surfaced in the download manager; QuotaExceededError-driven cleanup UX |
| KMS decrypt throughput/cost at grading scale | Envelope encryption already amortizes to one unwrap per attempt; batch grading in the worker |
| Redis as triple-duty infra (cache, rate-limit, queues) | Separate instances per concern at scale; `maxmemory-policy=noeviction` on the queue instance; jobs table in Postgres as truth |
| Small team vs national-scale Postgres ops (vacuum, partitions, PITR) | Managed PG (Flexible Server) now; budget a Postgres-literate SRE before on-prem; partition-rotation janitors from day one |
| NestJS 12 (full ESM) lands ~Q3 2026 | Scaffold on v11/Node 24 now; avoid deep CJS-only coupling; schedule a migration checkpoint |

## 9. Phase mapping

| PRD phase | Stack work |
|---|---|
| **I — Foundation** | Turborepo scaffold; `packages/{config,schemas,db,observability}`; api modules auth + org-hierarchy + provisioning; closure table + JWKS auth; CSV import worker (COPY); CI/CD pipeline incl. Trivy/cosign; seeded k6 harness |
| **II — Sync & CBT** | `packages/{sync-protocol,offline-store,crypto}`; Serwist SW + outbox; cbt-sync module + LWW upsert + partitions + pressure valve; KMS key ceremony; grading worker; offline E2E in CI; 3× load test |
| **III — Course player** | courses module + JSONB manifests; `packages/prefetch` + NetworkProfile; download manager; hls-packaging worker; hls.js/Shaka offline video; CDN + signed URLs |
| **IV — Credentials** | credentials module + Ed25519 issuance; `apps/verify` + read-model + CDN; Open Badges 3.0 export; revocation + audit; national load-test rerun |

## 10. Mobile path (and the honest dissent)

**Mobile:** Stage 1 — the PWA itself on the Android-dominant fleet (free). Stage 2 —
TWA via Bubblewrap for Play Store/MDM presence (weeks, zero new code). Stage 3 — Expo
React Native app in the same monorepo when justified: `schemas`, `sync-protocol`,
`api-client`, and `crypto` are pure/portable TS; `offline-store`'s repositories are
written against StoragePort — the RN driver is expo-sqlite/OP-SQLite implementing the
same port, so the sync engine and LWW logic are **reused, not rewritten**. New work is
the navigation shell, native video/download UX, push, and the SQLite driver.

**The dissent worth recording:** the strongest argument against this architecture is
that it carries Next.js App Router into a 100%-offline exam client purely to honor a
framework preference — practitioners who succeed do so by manually rebuilding the SPA
app-shell model inside Next, and the Serwist/Turbopack seam is the most fragile part
of the plan. A **Vite + React SPA for the learner app** would delete that risk class
entirely (the build *is* the precachable shell), and every hard piece — IndexedDB
repositories, outbox, LWW, envelope crypto, HLS interception — is identical
injectManifest TypeScript either way. If, during Phase II, the offline E2E suite keeps
catching Next-induced regressions, the pre-approved fallback is: keep `apps/web`
(Next.js) for admin + public surfaces, move the learner shell to a Vite SPA (`apps/learner`)
consuming the same packages. Nothing else in the architecture changes.
