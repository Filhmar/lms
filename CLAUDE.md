# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repo is **pre-implementation**. It currently contains only the product/architecture
spec at [docs/plan.md](docs/plan.md) (the PRD for "Resilient-Learn"). `README.md` and
`.gitignore` are empty and there are no commits yet. There is no application code, no
build system, and no tests. When scaffolding the codebase, derive structure and stack
choices from the PRD unless the user directs otherwise, and update this file with real
build/lint/test commands once they exist.

## What we are building

An offline-first Progressive Web App LMS intended to replace a failing DepEd Moodle
deployment at national scale. The central design goal is eliminating 500/502/505 errors
by making the system stateless, horizontally scalable, and resilient to intermittent
connectivity. The device (PWA) is the source of truth during exams; the server
aggregates. Delivery is planned in four phases (see the PRD for full detail):

- **Phase I — Foundation:** hierarchy, stateless auth, DB schema.
- **Phase II — Sync Engine & CBT:** offline testing + encrypted, conflict-free sync.
- **Phase III — Headless Course Player:** JSON-manifest content, prefetching, offline video.
- **Phase IV — Micro-credentials:** cryptographic certificates + standalone verification portal.

## Planned stack

- **Frontend:** React or Vue PWA with Workbox service worker; IndexedDB via the `idb` library.
- **API:** Node.js or Go on Azure Container Apps (scales to zero / to peak).
- **Database:** PostgreSQL using **closure tables** for hierarchy.
- **Cache:** Redis.
- **Async jobs:** queue-based workers (bulk CSV import, sync processing).
- **Object storage:** Azure Blob Storage (raw uploads, video segments); MinIO for on-prem.
- **Observability:** OpenTelemetry (includes a "sync heartbeat" telemetry pulse from the SW).
- **Crypto:** Web Crypto API (RSA-OAEP) in the browser; KMS/HSM holds private keys server-side.

Annex A of the PRD maps every component to AWS / GCP / on-prem equivalents — honor that
mapping so infrastructure stays portable (e.g. code targets the S3-compatible API so
Azure Blob / S3 / MinIO are interchangeable).

## Architecture concepts that span multiple components

These are the cross-cutting decisions a new contributor must understand before touching
any single module; they recur throughout the codebase-to-be.

### Hierarchy & scoping (closure table)

Five levels: **Central → Region → Division → District → School**. Instead of adjacency-list
`parent_id` (recursive, slow), every ancestor/descendant relationship is stored flat in a
`scope_hierarchy` closure table (`ancestor_id`, `descendant_id`, `depth`). This turns
sub-tree and breadcrumb lookups into single non-recursive index scans (target <50ms).

- **Downward inheritance:** content owned by an ancestor scope is visible to all descendants.
- **Lateral isolation:** sibling scopes cannot see each other's data.
- Content visibility query joins `courses.owner_scope_id` to `scope_hierarchy.ancestor_id`
  filtered by the learner's `descendant_id` (taken from their JWT).

### Stateless auth

JWT-based; the server stores **no** session. The token carries user ID, role, and
`scope_id`. Access tokens are short-lived (15 min); refresh tokens are long-lived (7 days)
and are the only auth artifact stored in the DB (touched only on refresh). Removing the
session table is the primary fix for the "500 under load" problem — never reintroduce
server-side session state.

### Offline-first data flow (the core pattern)

The same local-first, background-sync pattern is reused by the CBT engine **and** the
course player — implement it once and share it:

1. **Local persistence:** UI writes go to IndexedDB first (never `localStorage` — it's
   synchronous and blocks the UI thread). This is the "safety net" against crashes/power loss.
2. **Repository pattern:** IndexedDB access is wrapped in promise-based repositories (see the
   `CBTRepository` sketch in the PRD) that perform **atomic transactions** — e.g. writing an
   answer and enqueuing its sync record succeed or fail together.
3. **Sync queue:** an auto-increment `sync_queue` store holds `pending`/`syncing`/`failed`
   records with a `retry_count`.
4. **Drip sync via Background Sync API:** the service worker sends small batches (~every 30s
   online, or on reconnect) rather than one large submit — this spreads server load and
   survives tab close. Workbox `BackgroundSyncPlugin` with a sync tag drives this.

### Conflict resolution (CRDT)

Merges use a **state-based LWW-Element-Set**: each answer/progress event is a tuple
`(id, value, client_timestamp)`. On sync the server keeps the higher `client_timestamp`.
This makes merges deterministic and order-independent (e.g. a student switching between a
phone and a school tablet while offline). Always stamp `client_timestamp` at write time —
the server relies on it.

### Answer encryption (asymmetric)

Because correct answers and responses live on the device in an offline model, answers are
encrypted at write time with the **server's RSA-OAEP public key** before hitting IndexedDB;
only the server's private key can decrypt for grading. A student inspecting local storage
sees ciphertext. Public keys are **versioned per examination** (`exam_v1` ↔ `public_key_v1`)
so a compromised key doesn't expose exam history.

### Service worker strategies

- **Assets (js/css/images):** Cache-First / Stale-While-Revalidate.
- **Data (`/api/v1/...`):** Network-First, but on `500/502/505`/timeout the SW intercepts and
  returns the most recent IndexedDB value as a mock response so the UI keeps running.
- **Selective download:** explicit "Download Module" action fetches a module's assets into a
  named cache and posts progress messages back to the UI.

### Headless course delivery

Server sends a lightweight JSON **course manifest** (chapters → pages with a `type`
discriminator), not rendered HTML. The PWA renders via a type switch (`text_content`,
`video`, `assessment_embed`, …). Prefetching is **network-aware** (`navigator.connection`):
aggressive on 4G/WiFi, minimal on 3G, disabled on 2G / Save-Data. Prefetch runs in
`requestIdleCallback` at `fetch(..., { priority: 'low' })`, triggered by an IntersectionObserver
sentinel as the user progresses. Offline video uses HLS segments stored as encrypted blobs in
IndexedDB; a SW interceptor serves them as a local `ReadableStream`.

### Micro-credentials & verification

Credentials are **cryptographic assertions**, not PDFs: metadata (user, course, issue date,
scope) → SHA-256 hash → signed with the server private key (RSA-PSS), plus a
`metadata_snapshot` (JSONB) so proof survives even if the source course is deleted. The
**verification portal is a separate read-only microservice** with its own minimal
`Issued_Credentials` read table (no joins against Users/Courses), rate-limited, CDN-fronted,
public. It verifies the signature with the public key and checks `is_revoked`. Uses Open
Badges 3.0; each credential exposes `verify.lms.gov/v/{hash}` via QR. Returned names are
masked (e.g. `J** D**`) for data-privacy compliance.

## Async bulk import pattern

User provisioning (CSV) is **job-based**, never synchronous (avoids 502 timeouts):
validate structure → save raw file to blob storage → enqueue background job → return
`202 Accepted` with a `job_id` and a status link. The worker does scope validation
(closure table), sanitization, and **bulk COPY** insertion (not per-row INSERT), marking
users `pending_activation`. Clients poll `GET /api/v1/provisioning/job/{job_id}`.
