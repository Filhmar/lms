/**
 * Live end-to-end verification of Phase IV micro-credentials
 * (run with: npx tsx scripts/verify-credentials.ts — services + FRESH seed +
 * backend on :3200 + standalone verify service on :3300 must be up; Ana must
 * not have attempted the seeded exam yet).
 *
 * Drives: take-and-grade → auto-issued badge (no duplicates on re-issue
 * replay) → full course completion → auto-issued certificate (once) →
 * VC proof shape + independent Ed25519 verification + tamper detection →
 * public verify on BOTH the in-monolith endpoint and the standalone portal
 * (verified / revoked / not_found / masked names) → admin revoke/restore +
 * audit + non-admin 403 → 30/min/IP rate limit (429).
 */
import { randomUUID, webcrypto } from "node:crypto";
import { Pool } from "pg";
import { maskName } from "@rl/schemas";
import { loadDotEnv } from "../src/platform/config";
import { issueBadgeForGradedAttempt, ensureIssuerKeyV1 } from "../src/modules/credentials/issue-credential";
import { verifyVc } from "../src/modules/credentials/vc";

const BASE = process.env.API_BASE ?? "http://127.0.0.1:3200/api/v1";
const VERIFY_BASE = process.env.VERIFY_SERVICE_BASE ?? "http://127.0.0.1:3300";
const { subtle } = webcrypto;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function api<T = any>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; base?: string } = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${opts.base ?? BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: T;
  try {
    json = (text ? JSON.parse(text) : null) as T;
  } catch {
    json = null as T;
  }
  return { status: res.status, json };
}

async function login(email: string, password: string): Promise<string> {
  const { status, json } = await api<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (status !== 200) throw new Error(`login ${email} failed: ${status}`);
  return json.accessToken;
}

/** Client-side envelope encryption — mirrors the PWA (see verify-cbt.ts). */
async function encryptAnswer(
  publicKeyPem: string,
  keyVersion: number,
  value: string,
): Promise<Record<string, unknown>> {
  const der = Buffer.from(
    publicKeyPem.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s/g, ""),
    "base64",
  );
  const rsaKey = await subtle.importKey(
    "spki",
    der,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const aesKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
  ]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    Buffer.from(JSON.stringify({ value }), "utf8"),
  );
  const rawAes = await subtle.exportKey("raw", aesKey);
  const wrappedKey = await subtle.encrypt({ name: "RSA-OAEP" }, rsaKey, rawAes);
  return {
    alg: "RSA-OAEP-256+A256GCM",
    keyVersion,
    wrappedKey: Buffer.from(wrappedKey).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64"),
  };
}

async function main(): Promise<void> {
  loadDotEnv(process.cwd());
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  /* 1 — Take-and-grade: Ana attempts the seeded exam → badge auto-issued. */
  const ana = await login("ana.reyes@deped.gov.ph", "Student!2026");
  const exams = await api<any[]>("/exams", { token: ana });
  const exam = exams.json.find((e) => e.title === "Science 8 · Quarter 2 Periodical");
  if (!exam) throw new Error("seeded exam not visible — is the seed fresh?");
  if (exam.attemptState !== "none") {
    throw new Error(
      `Ana already has a ${exam.attemptState} attempt — reset the DB (fresh seed) first`,
    );
  }

  const pkg = await api<any>(`/exams/${exam.id}/package`, { token: ana });
  const start = await api<any>(`/exams/${exam.id}/attempts`, { method: "POST", token: ana });
  const attemptId = start.json?.attemptId as string;
  const bySeq = new Map<number, any>(pkg.json.questions.map((q: any) => [q.seq, q]));
  const now = Date.now();
  const answer = async (seq: number, value: string, offset: number) => ({
    kind: "answer" as const,
    id: randomUUID(),
    attemptId,
    questionId: bySeq.get(seq).id,
    payload: await encryptAnswer(pkg.json.publicKeyPem, pkg.json.keyVersion, value),
    clientTs: now - offset,
  });
  // 3 correct answers (q1 opt-2, q2 opt-3, q3 true) → expected score 3/12.
  const events = [
    await answer(1, "opt-2", 60_000),
    await answer(2, "opt-3", 50_000),
    await answer(3, "true", 40_000),
    { kind: "submit" as const, id: randomUUID(), attemptId, answeredCount: 3, clientTs: now },
  ];
  const sync = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events } });
  check(
    "1a. answers + submit all merged",
    sync.json?.results?.every((r: any) => r.outcome === "merged"),
    String(sync.json?.results?.map((r: any) => r.outcome)),
  );

  let graded: any = null;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await api<any>(`/attempts/${attemptId}`, { token: ana });
    if (s.json?.state === "graded") { graded = s.json; break; }
  }
  check("1b. attempt graded by worker", graded !== null, `score=${graded?.score}`);

  const wallet1 = await api<any[]>("/credentials", { token: ana });
  const badges = wallet1.json.filter((c) => c.kind === "badge" && c.title === exam.title);
  check(
    "1c. badge auto-issued into the wallet (exactly one)",
    wallet1.status === 200 && badges.length === 1,
    `badges=${badges.length}, monogram=${badges[0]?.monogram}, control=${badges[0]?.controlNo}`,
  );
  check("1d. badge monogram derived (S8)", badges[0]?.monogram === "S8", badges[0]?.monogram);
  const badge = badges[0];

  /* 1e — replay the grading-worker issuance path directly → must dedupe. */
  const attemptRow = await pool.query<{ id: string }>(
    `SELECT id FROM cbt.attempts WHERE id = $1::uuid AND state = 'graded'`,
    [attemptId],
  );
  const client = await pool.connect();
  let replay: unknown = "not-run";
  try {
    await client.query("BEGIN");
    const key = await ensureIssuerKeyV1(client);
    replay = await issueBadgeForGradedAttempt(
      client,
      attemptRow.rows[0]!.id,
      key,
      "http://localhost:3000/verify",
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  const wallet1b = await api<any[]>("/credentials", { token: ana });
  check(
    "1e. re-grading replay does NOT duplicate the badge",
    replay === null &&
      wallet1b.json.filter((c) => c.kind === "badge" && c.title === exam.title).length === 1,
    `replay=${JSON.stringify(replay)}`,
  );

  /* 2 — Course completion → certificate auto-issued exactly once. */
  const courses = await api<any[]>("/courses", { token: ana });
  const course = courses.json.find((c) => c.title === "Science 8");
  const manifest = await api<any>(`/courses/${course.id}/manifest`, { token: ana });
  const pageIds: string[] = manifest.json.chapters.flatMap((ch: any) =>
    ch.pages.map((p: any) => p.id),
  );
  const progressEvents = pageIds.map((pageId, i) => ({
    kind: "progress" as const,
    id: randomUUID(),
    courseId: course.id,
    pageId,
    clientTs: now - 30_000 + i,
  }));
  const progressSync = await api<any>("/sync/batch", {
    method: "POST",
    token: ana,
    body: { events: progressEvents },
  });
  check(
    "2a. all page completions merged",
    progressSync.json?.results?.every((r: any) => r.outcome === "merged"),
    `${pageIds.length} pages`,
  );
  const wallet2 = await api<any[]>("/credentials", { token: ana });
  const certs = wallet2.json.filter(
    (c) => c.kind === "certificate" && c.title === "Science 8 — Completed",
  );
  check("2b. certificate auto-issued on full completion (exactly one)", certs.length === 1,
    `certs=${certs.length}, control=${certs[0]?.controlNo}`);

  // Replaying the same progress events (duplicates) must not re-issue.
  await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: progressEvents } });
  const wallet2b = await api<any[]>("/credentials", { token: ana });
  check(
    "2c. progress replay does NOT duplicate the certificate",
    wallet2b.json.filter((c) => c.kind === "certificate" && c.title === "Science 8 — Completed")
      .length === 1,
  );

  /* 3 — VC detail: eddsa-jcs-2022 proof, independent verify, tamper test. */
  const detail = await api<any>(`/credentials/${badge.id}`, { token: ana });
  const vc = detail.json?.vc;
  check(
    "3a. detail carries DataIntegrityProof / eddsa-jcs-2022",
    vc?.proof?.type === "DataIntegrityProof" && vc?.proof?.cryptosuite === "eddsa-jcs-2022",
    `verifyUrl=${detail.json?.verifyUrl}`,
  );
  const keyRow = await pool.query<{ public_key_pem: string }>(
    `SELECT public_key_pem FROM creds.issuer_keys WHERE version = 1`,
  );
  const publicKeyPem = keyRow.rows[0]!.public_key_pem;
  check("3b. independent Ed25519 proof verification succeeds", verifyVc(vc, publicKeyPem));
  const tampered = JSON.parse(JSON.stringify(vc));
  tampered.credentialSubject.achievement.name = "Science 8 · Quarter 2 Periodical (forged)";
  check("3c. tampered title FAILS signature verification", verifyVc(tampered, publicKeyPem) === false);
  const wrongSubject = JSON.parse(JSON.stringify(vc));
  wrongSubject.credentialSubject.name = "Juan Dela Cruz";
  check("3d. tampered holder name FAILS signature verification", verifyVc(wrongSubject, publicKeyPem) === false);

  /* 4 — Public verify on BOTH services (demo pair + junk code). */
  const expectMasked = maskName("Ana Reyes");
  for (const [label, base, prefix] of [
    ["backend :3200", BASE, "/verify"],
    ["standalone :3300", VERIFY_BASE, "/v1/verify"],
  ] as const) {
    const ok = await api<any>(`${prefix}/8KX2-94QF`, { base });
    check(
      `4a. ${label} 8KX2-94QF → verified + masked + signatureValid`,
      ok.status === 200 &&
        ok.json?.status === "verified" &&
        ok.json?.maskedName === expectMasked &&
        ok.json?.signatureValid === true &&
        ok.json?.controlNo === "2026-04-118203",
      `status=${ok.json?.status}, masked=${ok.json?.maskedName}, sig=${ok.json?.signatureValid}`,
    );
    const revoked = await api<any>(`${prefix}/8KX2-94QG`, { base });
    check(
      `4b. ${label} 8KX2-94QG → revoked (details kept, signature still valid)`,
      revoked.json?.status === "revoked" && revoked.json?.signatureValid === true,
      `status=${revoked.json?.status}`,
    );
    const junk = await api<any>(`${prefix}/ZZZZ-9999`, { base });
    check(
      `4c. ${label} junk code → not_found (same shape)`,
      junk.status === 200 && junk.json?.status === "not_found" && junk.json?.maskedName === null,
      `status=${junk.json?.status}`,
    );
  }

  /* 5 — Admin oversight: revoke → restore, audit, non-admin 403. */
  const admin = await login("admin@deped.gov.ph", "ChangeMe!2026");
  const adminList = await api<any>("/credentials/admin", { token: admin });
  const badgeInList = adminList.json?.items?.find((i: any) => i.id === badge.id);
  check(
    "5a. admin list shows holder names (unmasked)",
    adminList.status === 200 && badgeInList?.holderName === "Ana Reyes",
    `total=${adminList.json?.total}, holder=${badgeInList?.holderName}`,
  );

  const notAdmin = await api<any>(`/credentials/${badge.id}/revoke`, {
    method: "POST",
    token: ana,
    body: { reason: "students cannot revoke" },
  });
  check("5b. non-admin revoke → 403", notAdmin.status === 403, `status=${notAdmin.status}`);

  const revoke = await api<any>(`/credentials/${badge.id}/revoke`, {
    method: "POST",
    token: admin,
    body: { reason: "Wrong learner record" },
  });
  check(
    "5c. admin revoke succeeds with reason",
    revoke.status === 200 && revoke.json?.status === "revoked" &&
      revoke.json?.revokedReason === "Wrong learner record",
    `status=${revoke.json?.status}`,
  );
  const afterRevoke = await api<any>(`/v1/verify/${badge.verifyCode}`, { base: VERIFY_BASE });
  check(
    "5d. standalone portal flips to revoked",
    afterRevoke.json?.status === "revoked",
    `status=${afterRevoke.json?.status}`,
  );

  const restore = await api<any>(`/credentials/${badge.id}/restore`, {
    method: "POST",
    token: admin,
  });
  const afterRestore = await api<any>(`/v1/verify/${badge.verifyCode}`, { base: VERIFY_BASE });
  check(
    "5e. restore flips back to verified",
    restore.status === 200 && restore.json?.status === "active" &&
      afterRestore.json?.status === "verified" && afterRestore.json?.signatureValid === true,
    `portal=${afterRestore.json?.status}`,
  );

  const audit = await pool.query<{ action: string; reason: string | null }>(
    `SELECT action, reason FROM creds.audit WHERE credential_id = $1::uuid ORDER BY at`,
    [badge.id],
  );
  check(
    "5f. audit trail: issued → revoked(reason) → restored",
    audit.rows.length === 3 &&
      audit.rows[0]?.action === "issued" &&
      audit.rows[1]?.action === "revoked" &&
      audit.rows[1]?.reason === "Wrong learner record" &&
      audit.rows[2]?.action === "restored",
    audit.rows.map((r) => r.action).join(","),
  );

  /* 6 — Rate limit: 31 rapid backend hits → 429 appears (kept LAST: the
     window then throttles this IP for up to a minute). */
  const statuses: number[] = [];
  for (let i = 0; i < 31; i++) {
    const r = await api<any>("/verify/8KX2-94QF");
    statuses.push(r.status);
  }
  check(
    "6. 31 rapid requests → 429 on the backend verify path",
    statuses.includes(429),
    `last=${statuses[30]}, first429@${statuses.indexOf(429) + 1}`,
  );

  await pool.end();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("verify-credentials crashed:", err);
  process.exitCode = 1;
});
