import { randomInt } from "node:crypto";
import { maskName } from "@rl/schemas";
import type { ClientBase } from "pg";
import {
  assertionHashHex,
  buildUnsignedVc,
  generateIssuerKeyPair,
  signVc,
} from "./vc";

/**
 * Issuance primitives — pure functions over a pg client (no Nest wiring),
 * imported by the CredentialIssuer service AND scripts/seed.ts so the demo
 * credentials go through the exact same code path (cbt/exam-crypto pattern).
 *
 * Every write here (credentials + verify_read + audit) happens on the
 * caller's client: callers own the BEGIN/COMMIT so issue/revoke stay atomic.
 */

/* ----------------------------- issuer keys ----------------------------- */

export interface IssuerSigningKey {
  version: number;
  publicKeyPem: string;
  privateKeyPem: string;
}

/**
 * Ensure Ed25519 issuer key version 1 exists (boot + seed, race-safe via
 * ON CONFLICT (version) DO NOTHING) and return it.
 */
export async function ensureIssuerKeyV1(client: ClientBase): Promise<IssuerSigningKey> {
  const existing = await loadIssuerKey(client, 1);
  if (existing) return existing;
  const pair = generateIssuerKeyPair();
  await client.query(
    `INSERT INTO creds.issuer_keys (version, public_key_pem, private_key_pem)
     VALUES (1, $1, $2)
     ON CONFLICT (version) DO NOTHING`,
    [pair.publicKeyPem, pair.privateKeyPem],
  );
  const settled = await loadIssuerKey(client, 1);
  if (!settled) throw new Error("issuer key v1 vanished after insert");
  return settled;
}

async function loadIssuerKey(
  client: ClientBase,
  version: number,
): Promise<IssuerSigningKey | null> {
  const result = await client.query<{
    version: number;
    public_key_pem: string;
    private_key_pem: string;
  }>(
    `SELECT version, public_key_pem, private_key_pem
     FROM creds.issuer_keys WHERE version = $1`,
    [version],
  );
  const row = result.rows[0];
  return row
    ? {
        version: row.version,
        publicKeyPem: row.public_key_pem,
        privateKeyPem: row.private_key_pem,
      }
    : null;
}

/* ------------------------- derivation helpers ------------------------- */

/** Medallion monogram: subject initial + grade digits — "Science 8 ·
 *  Quarter 2 Periodical" → "S8", "Grade 7 Completion" → "G7". */
export function deriveMonogram(title: string): string {
  const initial = (title.match(/[A-Za-z]/)?.[0] ?? "").toUpperCase();
  const digits = title.match(/\d+/)?.[0] ?? "";
  return `${initial}${digits.slice(0, 2)}` || "RL";
}

/** Unambiguous code alphabet: A–Z + 2–9 minus lookalikes I/L/O (and 0/1). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomVerifyCode(): string {
  const block = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${block()}-${block()}`;
}

/** A verify code not yet in use (pre-checked — a collision inside the
 *  transaction would abort it; at 31^8 codes retries are theoretical). */
async function freeVerifyCode(client: ClientBase): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomVerifyCode();
    const hit = await client.query(
      `SELECT 1 FROM creds.credentials WHERE verify_code = $1`,
      [code],
    );
    if (hit.rowCount === 0) return code;
  }
  throw new Error("could not allocate a verify code");
}

/** Registry number YYYY-MM-NNNNNN from creds.control_no_seq. */
async function nextControlNo(client: ClientBase, at: Date): Promise<string> {
  const result = await client.query<{ n: string }>(
    `SELECT nextval('creds.control_no_seq') AS n`,
  );
  const seq = String(result.rows[0]!.n).padStart(6, "0");
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${at.getUTCFullYear()}-${month}-${seq}`;
}

export interface IssuerLineInfo {
  /** e.g. "San Isidro NHS, Division of Cavite, Region IV-A". */
  issuerLine: string;
  /** Full breadcrumb names, scope-first up to Central (snapshot material). */
  scopeNames: string[];
}

/**
 * Issuer line from the closure-table breadcrumb: the issuing scope itself,
 * then its division and region (the design's display chain — district and
 * Central are omitted).
 */
export async function issuerLineFor(
  client: ClientBase,
  scopeId: string,
): Promise<IssuerLineInfo> {
  const result = await client.query<{ name: string; level: string; depth: number }>(
    `SELECT s.name, s.level::text AS level, sh.depth
     FROM org.scope_hierarchy sh
     JOIN org.scopes s ON s.id = sh.ancestor_id
     WHERE sh.descendant_id = $1::uuid
     ORDER BY sh.depth ASC`,
    [scopeId],
  );
  if (result.rows.length === 0) throw new Error(`unknown scope ${scopeId}`);
  const parts = result.rows
    .filter((r) => r.depth === 0 || r.level === "division" || r.level === "region")
    .map((r) => r.name);
  return {
    issuerLine: parts.join(", "),
    scopeNames: result.rows.map((r) => r.name),
  };
}

/* ------------------------------ issuance ------------------------------ */

export interface IssueCredentialInput {
  userId: string;
  kind: "badge" | "certificate";
  title: string;
  holderName: string;
  issuedScopeId: string;
  examId?: string | null;
  courseId?: string | null;
  /** Kind-specific snapshot extras (score, source titles, …). */
  snapshotExtra?: Record<string, unknown>;
  key: IssuerSigningKey;
  /** VERIFY_PUBLIC_BASE — issuer id + verify URL base. */
  verifyBase: string;
  /** Seed-only deterministic overrides for the demo credentials. */
  forced?: { controlNo: string; verifyCode: string };
}

export interface IssuedCredential {
  id: string;
  verifyCode: string;
  controlNo: string;
  title: string;
  kind: "badge" | "certificate";
}

/**
 * Issue one credential: build + Ed25519-sign the OB 3.0 VC, then write
 * creds.credentials + creds.verify_read + creds.audit on the caller's
 * (transactional) client. Race-safe idempotence: the INSERT lands on the
 * partial unique (user, exam)/(user, course) index with ON CONFLICT DO
 * NOTHING — returns null when the credential already exists.
 */
export async function issueCredential(
  client: ClientBase,
  input: IssueCredentialInput,
): Promise<IssuedCredential | null> {
  const issuedAt = new Date();
  const { issuerLine, scopeNames } = await issuerLineFor(client, input.issuedScopeId);
  const controlNo = input.forced?.controlNo ?? (await nextControlNo(client, issuedAt));
  const verifyCode = input.forced?.verifyCode ?? (await freeVerifyCode(client));
  const monogram = deriveMonogram(input.title);

  // metadata_snapshot: everything a proof needs even after the source exam/
  // course/user rows are deleted.
  const snapshot: Record<string, unknown> = {
    holderName: input.holderName,
    scopeNames,
    issuerLine,
    kind: input.kind,
    title: input.title,
    ...(input.snapshotExtra ?? {}),
  };

  const description =
    input.kind === "badge"
      ? `Badge for the graded examination "${snapshot.examTitle ?? input.title}"${
          typeof snapshot.score === "string" ? ` with a score of ${snapshot.score}` : ""
        }, issued by ${issuerLine}.`
      : `Certificate of completion for "${snapshot.courseTitle ?? input.title}", issued by ${issuerLine}.`;
  const criteria =
    input.kind === "badge"
      ? "Awarded automatically when the holder's examination attempt was graded."
      : "Awarded automatically when the holder completed every page of the course.";

  const unsignedVc = buildUnsignedVc({
    credentialUrl: `${input.verifyBase}/c/${verifyCode}`,
    issuerId: input.verifyBase,
    issuerName: issuerLine,
    validFrom: issuedAt.toISOString(),
    holderName: input.holderName,
    achievementName: input.title,
    achievementDescription: description,
    criteriaNarrative: criteria,
  });
  const assertionHash = assertionHashHex(unsignedVc);
  const vc = signVc(
    unsignedVc,
    input.key.privateKeyPem,
    `${input.verifyBase}/keys/${input.key.version}`,
    issuedAt.toISOString(),
  );

  // Conflict target: the partial unique index for the source kind; forced
  // demo credentials (no source) dedupe on verify_code instead.
  const conflict = input.examId
    ? "(user_id, exam_id) WHERE exam_id IS NOT NULL"
    : input.courseId
      ? "(user_id, course_id) WHERE course_id IS NOT NULL"
      : "(verify_code)";
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO creds.credentials
       (user_id, kind, title, monogram, control_no, verify_code, exam_id,
        course_id, issued_scope_id, issuer_line, metadata_snapshot, vc,
        assertion_hash, key_version, status, issued_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9::uuid,
             $10, $11::jsonb, $12::jsonb, $13, $14, 'active', $15)
     ON CONFLICT ${conflict} DO NOTHING
     RETURNING id`,
    [
      input.userId,
      input.kind,
      input.title,
      monogram,
      controlNo,
      verifyCode,
      input.examId ?? null,
      input.courseId ?? null,
      input.issuedScopeId,
      issuerLine,
      JSON.stringify(snapshot),
      JSON.stringify(vc),
      assertionHash,
      input.key.version,
      issuedAt,
    ],
  );
  const row = inserted.rows[0];
  if (!row) return null; // already issued (idempotent replay / lost race)

  await client.query(
    `INSERT INTO creds.verify_read
       (verify_code, status, masked_name, title, issuer_line, issued_at,
        control_no, assertion_hash, vc, key_version)
     VALUES ($1, 'active', $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      verifyCode,
      maskName(input.holderName),
      input.title,
      issuerLine,
      issuedAt,
      controlNo,
      assertionHash,
      JSON.stringify(vc),
      input.key.version,
    ],
  );
  await client.query(
    `INSERT INTO creds.audit (credential_id, action, actor_user_id, reason)
     VALUES ($1::uuid, 'issued', NULL, NULL)`,
    [row.id],
  );

  return { id: row.id, verifyCode, controlNo, title: input.title, kind: input.kind };
}

/* --------------------- automatic issuance sources --------------------- */

/**
 * Badge for a graded exam attempt (called by the grading worker after the
 * attempt lands in `graded`, and by re-graded replays — idempotent). Null
 * when the attempt isn't graded or the badge already exists.
 */
export async function issueBadgeForGradedAttempt(
  client: ClientBase,
  attemptId: string,
  key: IssuerSigningKey,
  verifyBase: string,
): Promise<IssuedCredential | null> {
  const result = await client.query<{
    user_id: string;
    exam_id: string;
    state: string;
    score_raw: number | null;
    score_total: number | null;
    exam_title: string;
    owner_scope_id: string;
    full_name: string;
  }>(
    `SELECT a.user_id, a.exam_id, a.state, a.score_raw, a.score_total,
            e.title AS exam_title, e.owner_scope_id, u.full_name
     FROM cbt.attempts a
     JOIN cbt.exams e ON e.id = a.exam_id
     JOIN auth.users u ON u.id = a.user_id
     WHERE a.id = $1::uuid`,
    [attemptId],
  );
  const row = result.rows[0];
  if (!row || row.state !== "graded") return null;

  // Cheap existence check — the partial unique index still backstops races.
  const existing = await client.query(
    `SELECT 1 FROM creds.credentials WHERE user_id = $1::uuid AND exam_id = $2::uuid`,
    [row.user_id, row.exam_id],
  );
  if ((existing.rowCount ?? 0) > 0) return null;

  return issueCredential(client, {
    userId: row.user_id,
    kind: "badge",
    title: row.exam_title,
    holderName: row.full_name,
    issuedScopeId: row.owner_scope_id,
    examId: row.exam_id,
    snapshotExtra: {
      examTitle: row.exam_title,
      score:
        row.score_raw !== null && row.score_total !== null
          ? `${row.score_raw}/${row.score_total}`
          : null,
    },
    key,
    verifyBase,
  });
}

/**
 * Certificate when a user's completed-page count reaches the course's total
 * (called from the progress-sync path after merged events — idempotent).
 */
export async function maybeIssueCertificateForCourse(
  client: ClientBase,
  userId: string,
  courseId: string,
  key: IssuerSigningKey,
  verifyBase: string,
): Promise<IssuedCredential | null> {
  // Cheap existence check first — most syncs are mid-course.
  const existing = await client.query(
    `SELECT 1 FROM creds.credentials WHERE user_id = $1::uuid AND course_id = $2::uuid`,
    [userId, courseId],
  );
  if ((existing.rowCount ?? 0) > 0) return null;

  const result = await client.query<{
    title: string;
    owner_scope_id: string;
    total_pages: number;
    completed: number;
    full_name: string | null;
  }>(
    `SELECT c.title, c.owner_scope_id,
            (SELECT count(*)::int FROM courses.pages p
             JOIN courses.chapters ch ON ch.id = p.chapter_id
             WHERE ch.course_id = c.id) AS total_pages,
            (SELECT count(*)::int FROM courses.progress pr
             WHERE pr.user_id = $2::uuid AND pr.course_id = c.id) AS completed,
            (SELECT u.full_name FROM auth.users u WHERE u.id = $2::uuid) AS full_name
     FROM courses.courses c
     WHERE c.id = $1::uuid`,
    [courseId, userId],
  );
  const row = result.rows[0];
  if (!row || row.full_name === null) return null;
  if (row.total_pages === 0 || row.completed < row.total_pages) return null;

  return issueCredential(client, {
    userId,
    kind: "certificate",
    title: `${row.title} — Completed`,
    holderName: row.full_name,
    issuedScopeId: row.owner_scope_id,
    courseId,
    snapshotExtra: {
      courseTitle: row.title,
      pagesCompleted: `${row.completed}/${row.total_pages}`,
    },
    key,
    verifyBase,
  });
}
