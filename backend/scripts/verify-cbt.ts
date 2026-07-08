/**
 * Live end-to-end verification of the Phase II CBT + sync backend
 * (run with: npx tsx scripts/verify-cbt.ts — services + seed + API must be up).
 *
 * Plays the PWA's role with node:crypto WebCrypto: envelope-encrypts answers
 * (AES-256-GCM data key wrapped with the exam's RSA-OAEP-256 public key,
 * plaintext { "value": string }, GCM tag appended to ciphertext — the exact
 * shape in src/modules/cbt/exam-crypto.ts), then drives:
 *   login → list → package → attempt → LWW sync (merged/duplicate/stale/
 *   rejected) → submit → graded score → lateral isolation (Jose @ Salawag).
 */
import { randomUUID, webcrypto } from "node:crypto";

const BASE = process.env.API_BASE ?? "http://127.0.0.1:3200/api/v1";
const { subtle } = webcrypto;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function api<T = any>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

async function login(email: string, password: string): Promise<string> {
  const { status, json } = await api<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (status !== 200) throw new Error(`login ${email} failed: ${status}`);
  return json.accessToken;
}

/** Client-side envelope encryption — mirrors what the PWA will do. */
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
  /* 1 — Ana sees the seeded exam (downward inheritance, attemptState none). */
  const ana = await login("ana.reyes@deped.gov.ph", "Student!2026");
  const list = await api<any[]>("/exams", { token: ana });
  const exam = list.json.find((e) => e.title === "Science 8 · Quarter 2 Periodical");
  check("1. GET /exams shows seeded exam for Ana", list.status === 200 && !!exam);
  check(
    "1. attemptState is none on first sight",
    exam?.attemptState === "none" && exam?.attemptId === null,
    `state=${exam?.attemptState}, items=${exam?.totalItems}, packageBytes=${exam?.packageBytes}`,
  );

  /* 2 — Package: 12 questions, zero `correct` anywhere, public key present. */
  const pkg = await api<any>(`/exams/${exam.id}/package`, { token: ana });
  const pkgRaw = JSON.stringify(pkg.json);
  check("2. package has 12 questions", pkg.json?.questions?.length === 12);
  check("2. no `correct` field anywhere in package JSON", !/"correct"/.test(pkgRaw));
  check(
    "2. no private key material in package JSON",
    !/PRIVATE KEY/.test(pkgRaw) && /BEGIN PUBLIC KEY/.test(pkg.json?.publicKeyPem ?? ""),
    `keyVersion=${pkg.json?.keyVersion}`,
  );

  /* 3 — Start attempt; re-POST is idempotent. */
  const start1 = await api<any>(`/exams/${exam.id}/attempts`, { method: "POST", token: ana });
  const start2 = await api<any>(`/exams/${exam.id}/attempts`, { method: "POST", token: ana });
  const attemptId = start1.json?.attemptId;
  const deadlineMs = new Date(start1.json?.deadlineAt).getTime() - Date.now();
  check(
    "3. start attempt returns sane deadline (~30 min)",
    start1.status === 200 && deadlineMs > 28 * 60_000 && deadlineMs <= 30 * 60_000,
    `deadline in ${(deadlineMs / 60000).toFixed(1)} min`,
  );
  check(
    "3. re-POST returns the SAME attemptId (idempotent)",
    start2.json?.attemptId === attemptId,
  );

  /* 4 — LWW sync. Question option ids: q1 correct=opt-2, q2 correct=opt-3,
     q3 correct=true. Plan: q1 correct now but LWW-overwritten to WRONG later;
     q2 correct; q3 correct → expected final score 2/12. */
  const byId = new Map<number, any>(pkg.json.questions.map((q: any) => [q.seq, q]));
  const now = Date.now();
  const mk = async (seq: number, value: string, clientTs: number, id = randomUUID()) => ({
    kind: "answer" as const,
    id,
    attemptId,
    questionId: byId.get(seq).id,
    payload: await encryptAnswer(pkg.json.publicKeyPem, pkg.json.keyVersion, value),
    clientTs,
  });

  const e1 = await mk(1, "opt-2", now - 60_000); // q1 right (for now)
  const e2 = await mk(2, "opt-3", now - 50_000); // q2 right
  const e3 = await mk(3, "true", now - 40_000); //  q3 right
  const batch1 = await api<any>("/sync/batch", {
    method: "POST",
    token: ana,
    body: { events: [e1, e2, e3] },
  });
  const o1 = batch1.json?.results?.map((r: any) => r.outcome);
  check("4a. three fresh answers all merged", JSON.stringify(o1) === '["merged","merged","merged"]', String(o1));

  const batch2 = await api<any>("/sync/batch", {
    method: "POST",
    token: ana,
    body: { events: [e1, e2, e3] },
  });
  const o2 = batch2.json?.results?.map((r: any) => r.outcome);
  check("4b. same event ids re-sent → duplicate", JSON.stringify(o2) === '["duplicate","duplicate","duplicate"]', String(o2));

  const older = await mk(1, "opt-1", now - 120_000); // older ts must LOSE
  const batch3 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [older] } });
  check("4c. older clientTs for q1 → stale", batch3.json?.results?.[0]?.outcome === "stale", String(batch3.json?.results?.[0]?.outcome));

  const newer = await mk(1, "opt-1", now - 10_000); // newer ts WINS → q1 now WRONG
  const batch4 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [newer] } });
  check("4d. newer clientTs changed answer for q1 → merged", batch4.json?.results?.[0]?.outcome === "merged", String(batch4.json?.results?.[0]?.outcome));

  const outside = await mk(4, "opt-2", now - 6 * 3600_000); // 6h before start
  const batch5 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [outside] } });
  const r5 = batch5.json?.results?.[0];
  check(
    "4e. clientTs far outside window → rejected",
    r5?.outcome === "rejected" && r5?.reason === "outside exam window",
    `${r5?.outcome} (${r5?.reason})`,
  );

  /* 5 — Submit → merged; status flips submitted, then graded with 2/12. */
  const submit = {
    kind: "submit" as const,
    id: randomUUID(),
    attemptId,
    answeredCount: 3,
    clientTs: now,
  };
  const batch6 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [submit] } });
  check("5a. submit event → merged", batch6.json?.results?.[0]?.outcome === "merged", String(batch6.json?.results?.[0]?.outcome));

  const statusNow = await api<any>(`/attempts/${attemptId}`, { token: ana });
  check(
    "5b. attempt flips to submitted (answersReceived=3)",
    statusNow.json?.state === "submitted" && statusNow.json?.answersReceived === 3,
    `state=${statusNow.json?.state}, received=${statusNow.json?.answersReceived}`,
  );

  const resubmit = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [submit] } });
  check("5c. re-sent submit event → duplicate", resubmit.json?.results?.[0]?.outcome === "duplicate", String(resubmit.json?.results?.[0]?.outcome));

  let graded: any = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await api<any>(`/attempts/${attemptId}`, { token: ana });
    if (s.json?.state === "graded") { graded = s.json; break; }
  }
  check("5d. attempt graded by worker within ~20s", graded !== null, `state=${graded?.state}`);
  check(
    "5e. score is 2/12 (q2+q3 right; q1 LWW winner is wrong)",
    graded?.score === "2/12",
    `score=${graded?.score}`,
  );
  const examAfter = (await api<any[]>("/exams", { token: ana })).json.find((e) => e.id === exam.id);
  check(
    "5f. GET /exams now shows graded attempt + score",
    examAfter?.attemptState === "graded" && examAfter?.score === "2/12",
    `state=${examAfter?.attemptState}, score=${examAfter?.score}`,
  );

  /* 6 — Lateral isolation: Jose (Salawag NHS) must NOT see San Isidro's exam. */
  const jose = await login("jose.rizal@deped.gov.ph", "Student!2026");
  const joseList = await api<any[]>("/exams", { token: jose });
  check(
    "6a. Jose (Salawag) does NOT see the San Isidro exam",
    joseList.status === 200 && !joseList.json.some((e) => e.id === exam.id),
    `visible exams for Jose: ${joseList.json.length}`,
  );
  const josePkg = await api<any>(`/exams/${exam.id}/package`, { token: jose });
  check("6b. Jose's direct package fetch → 404", josePkg.status === 404, `status=${josePkg.status}`);
  const joseStatus = await api<any>(`/attempts/${attemptId}`, { token: jose });
  check("6c. Jose can't read Ana's attempt → 404", joseStatus.status === 404, `status=${joseStatus.status}`);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("verify-cbt crashed:", err);
  process.exitCode = 1;
});
