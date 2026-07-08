/**
 * Live end-to-end verification of the Phase III courses backend
 * (run with: npx tsx scripts/verify-courses.ts — services + seed + API up).
 *
 * Drives: login → GET /courses (counts, lateral isolation) → manifest
 * (ordering, examId, assetPath) → authenticated asset streaming (bytes,
 * Range, 401/404) → progress sync through POST /sync/batch (merged/
 * duplicate/stale/rejected, future clientTs, invisible course) → GET
 * progress → mixed answer+progress batch with a freshly provisioned student.
 */
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const BASE = process.env.API_BASE ?? "http://127.0.0.1:3200/api/v1";
const COURSE_ID = "c0a15e00-0000-4000-8000-0000000000cc";
const EXAM_ID = "c0ffee00-0000-4000-8000-00000000cb70";
const SAN_ISIDRO = "55555555-5555-4555-8555-555555555555";
const { subtle } = webcrypto;

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function api<T = any>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: T; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json: json as T, headers: res.headers };
}

async function login(email: string, password: string): Promise<string> {
  const { status, json } = await api<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (status !== 200) throw new Error(`login ${email} failed: ${status}`);
  return json.accessToken;
}

/** Client-side envelope encryption — mirrors verify-cbt.ts / the PWA. */
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
    "spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"],
  );
  const aesKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv }, aesKey, Buffer.from(JSON.stringify({ value }), "utf8"),
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

const progressEvent = (pageId: string, clientTs: number, id = randomUUID()) => ({
  kind: "progress" as const,
  id,
  courseId: COURSE_ID,
  pageId,
  clientTs,
});

async function main(): Promise<void> {
  /* 1 — Ana sees the seeded course with real counts; Jose does not. */
  const ana = await login("ana.reyes@deped.gov.ph", "Student!2026");
  const list = await api<any[]>("/courses", { token: ana });
  const course = list.json.find?.((c) => c.id === COURSE_ID);
  check("1a. GET /courses shows Science 8 for Ana", list.status === 200 && !!course);
  check(
    "1b. counts: 3 chapters, 12 pages, completedPages 0",
    course?.chapters === 3 && course?.totalPages === 12 && course?.completedPages === 0,
    `chapters=${course?.chapters} totalPages=${course?.totalPages} completed=${course?.completedPages} manifestBytes=${course?.manifestBytes}`,
  );

  const jose = await login("jose.rizal@deped.gov.ph", "Student!2026");
  const joseList = await api<any[]>("/courses", { token: jose });
  check(
    "1c. Jose (Salawag) does NOT see the San Isidro course",
    joseList.status === 200 && !joseList.json.some((c: any) => c.id === COURSE_ID),
    `visible courses for Jose: ${joseList.json.length}`,
  );
  const joseManifest = await api<any>(`/courses/${COURSE_ID}/manifest`, { token: jose });
  check("1d. Jose's direct manifest fetch → 404", joseManifest.status === 404, `status=${joseManifest.status}`);

  /* 2 — Manifest: ordered chapters/pages, real examId, authenticated assetPath. */
  const manifest = await api<any>(`/courses/${COURSE_ID}/manifest`, { token: ana });
  const chapters = manifest.json?.chapters ?? [];
  const chSeqs = chapters.map((c: any) => c.seq);
  const ch3 = chapters.find((c: any) => c.seq === 3);
  const pageSeqs = ch3?.pages?.map((p: any) => p.seq) ?? [];
  check(
    "2a. manifest chapters ordered 1..3, Ch3 pages ordered 1..7",
    manifest.status === 200 &&
      JSON.stringify(chSeqs) === "[1,2,3]" &&
      JSON.stringify(pageSeqs) === "[1,2,3,4,5,6,7]",
    `chapters=${JSON.stringify(chSeqs)} ch3 pages=${JSON.stringify(pageSeqs)}`,
  );
  const assessment = ch3?.pages?.find((p: any) => p.type === "assessment_embed");
  check(
    "2b. assessment page (Ch3 p6) carries the real seeded examId",
    assessment?.seq === 6 && assessment?.examId === EXAM_ID,
    `examId=${assessment?.examId}`,
  );
  const videoPage = ch3?.pages?.find((p: any) => p.type === "video");
  const expectedPrefix = `/api/v1/courses/${COURSE_ID}/assets/`;
  check(
    "2c. video page exposes assetPath under /api/v1/courses/:id/assets/",
    !!videoPage?.video?.assetPath?.startsWith(expectedPrefix) && videoPage?.video?.sizeBytes > 0,
    `assetPath=${videoPage?.video?.assetPath} sizeBytes=${videoPage?.video?.sizeBytes} durationLabel=${videoPage?.video?.durationLabel}`,
  );
  const textPage = ch3?.pages?.find((p: any) => p.seq === 5);
  check(
    "2d. text page 5 'Storm signals' ships markdown body inline",
    textPage?.type === "text_content" && /PAGASA raises wind signals/.test(textPage?.body ?? ""),
  );

  /* 3 — Asset streaming: bytes match storage, Range works, 401/404 enforced. */
  const assetPath = (videoPage.video.assetPath as string).replace("/api/v1", "");
  const assetRes = await fetch(`${BASE}${assetPath}`, {
    headers: { authorization: `Bearer ${ana}` },
  });
  const assetBytes = Buffer.from(await assetRes.arrayBuffer());
  // Compare against what the seed stored through the ObjectStorage port.
  const storageDirRaw = readEnvStorageDir();
  const storedPath = join(storageDirRaw, "courses", COURSE_ID, assetPath.split("/").pop()!);
  const storedBytes = readFileSync(storedPath);
  check(
    "3a. GET asset with Ana's token → 200, bytes identical to stored object",
    assetRes.status === 200 &&
      assetBytes.length === videoPage.video.sizeBytes &&
      sha256(assetBytes) === sha256(storedBytes),
    `status=${assetRes.status} len=${assetBytes.length} type=${assetRes.headers.get("content-type")}`,
  );
  const rangeRes = await fetch(`${BASE}${assetPath}`, {
    headers: { authorization: `Bearer ${ana}`, range: "bytes=0-15" },
  });
  const rangeBytes = Buffer.from(await rangeRes.arrayBuffer());
  check(
    "3b. Range bytes=0-15 → 206 + Content-Range, first 16 bytes",
    rangeRes.status === 206 &&
      rangeBytes.length === 16 &&
      rangeRes.headers.get("content-range") === `bytes 0-15/${storedBytes.length}` &&
      rangeBytes.equals(storedBytes.subarray(0, 16)),
    `status=${rangeRes.status} content-range=${rangeRes.headers.get("content-range")}`,
  );
  const suffixRes = await fetch(`${BASE}${assetPath}`, {
    headers: { authorization: `Bearer ${ana}`, range: "bytes=-8" },
  });
  const suffixBytes = Buffer.from(await suffixRes.arrayBuffer());
  check(
    "3c. suffix Range bytes=-8 → 206, last 8 bytes",
    suffixRes.status === 206 && suffixBytes.equals(storedBytes.subarray(-8)),
    `status=${suffixRes.status}`,
  );
  const badRange = await fetch(`${BASE}${assetPath}`, {
    headers: { authorization: `Bearer ${ana}`, range: `bytes=${storedBytes.length + 10}-` },
  });
  check("3d. unsatisfiable Range → 416", badRange.status === 416, `status=${badRange.status}`);
  const noAuth = await fetch(`${BASE}${assetPath}`);
  check("3e. asset without token → 401", noAuth.status === 401, `status=${noAuth.status}`);
  const joseAsset = await fetch(`${BASE}${assetPath}`, {
    headers: { authorization: `Bearer ${jose}` },
  });
  check("3f. Jose (other school) asset fetch → 404", joseAsset.status === 404, `status=${joseAsset.status}`);

  /* 4 — Progress sync via POST /sync/batch. */
  const ch3Pages = ch3.pages;
  const pid = (seq: number) => ch3Pages.find((p: any) => p.seq === seq).id;
  const now = Date.now();
  const e1 = progressEvent(pid(1), now - 30_000);
  const e2 = progressEvent(pid(2), now - 20_000);
  const e3 = progressEvent(pid(3), now - 10_000);
  const b1 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [e1, e2, e3] } });
  const o1 = b1.json?.results?.map((r: any) => r.outcome);
  check("4a. three fresh progress events → merged", JSON.stringify(o1) === '["merged","merged","merged"]', String(o1));

  const b2 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [e1] } });
  check("4b. same event id re-sent → duplicate", b2.json?.results?.[0]?.outcome === "duplicate", String(b2.json?.results?.[0]?.outcome));

  const older = progressEvent(pid(1), now - 90_000);
  const b3 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [older] } });
  check("4c. older clientTs for same page → stale", b3.json?.results?.[0]?.outcome === "stale", String(b3.json?.results?.[0]?.outcome));

  const future = progressEvent(pid(4), now + 10 * 60_000);
  const b4 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [future] } });
  const r4 = b4.json?.results?.[0];
  check("4d. clientTs >now+5min → rejected", r4?.outcome === "rejected" && r4?.reason === "timestamp in the future", `${r4?.outcome} (${r4?.reason})`);

  // Invisible course: Jose replays a valid page of the San Isidro course.
  const joseEvent = progressEvent(pid(4), now);
  const b5 = await api<any>("/sync/batch", { method: "POST", token: jose, body: { events: [joseEvent] } });
  const r5 = b5.json?.results?.[0];
  check("4e. page from a course invisible to caller → rejected", r5?.outcome === "rejected" && r5?.reason === "unknown course", `${r5?.outcome} (${r5?.reason})`);

  // Page not belonging to the claimed course (fabricated page id).
  const wrongPage = progressEvent(randomUUID(), now);
  const b6 = await api<any>("/sync/batch", { method: "POST", token: ana, body: { events: [wrongPage] } });
  const r6 = b6.json?.results?.[0];
  check("4f. page that doesn't belong to the course → rejected", r6?.outcome === "rejected" && r6?.reason === "unknown page", `${r6?.outcome} (${r6?.reason})`);

  /* 5 — Progress read-back. */
  const progress = await api<any>(`/courses/${COURSE_ID}/progress`, { token: ana });
  const ids = progress.json?.completedPageIds ?? [];
  check(
    "5a. GET /courses/:id/progress → exactly the 3 merged pages",
    progress.status === 200 && ids.length === 3 &&
      [pid(1), pid(2), pid(3)].every((id) => ids.includes(id)),
    `completedPageIds=${ids.length}`,
  );
  const listAfter = await api<any[]>("/courses", { token: ana });
  const courseAfter = listAfter.json.find((c) => c.id === COURSE_ID);
  check("5b. GET /courses now shows completedPages=3", courseAfter?.completedPages === 3, `completed=${courseAfter?.completedPages}`);

  /* 6 — Mixed batch: answer (fresh in_progress attempt) + progress → both merged. */
  const admin = await login("admin@deped.gov.ph", "ChangeMe!2026");
  const email = `mixed.batch.${Date.now()}@deped.gov.ph`;
  const created = await api<any>("/users", {
    method: "POST",
    token: admin,
    body: { email, fullName: "Mixed Batch Tester", role: "student", scopeId: SAN_ISIDRO, phone: "+639171239876" },
  });
  const otp = await api<any>("/auth/activation/request", { method: "POST", body: { email } });
  const confirmed = await api<any>("/auth/activation/confirm", {
    method: "POST",
    body: { email, code: otp.json?.devCode, newPassword: "Fresh!2026pw" },
  });
  const fresh = confirmed.json?.accessToken ?? (await login(email, "Fresh!2026pw"));
  check(
    "6a. fresh student provisioned + activated (dev OTP)",
    created.status === 201 && !!fresh,
    `create=${created.status} otp=${otp.status} confirm=${confirmed.status}`,
  );

  const pkg = await api<any>(`/exams/${EXAM_ID}/package`, { token: fresh });
  const attempt = await api<any>(`/exams/${EXAM_ID}/attempts`, { method: "POST", token: fresh });
  const q1 = pkg.json?.questions?.find((q: any) => q.seq === 1);
  const mixed = await api<any>("/sync/batch", {
    method: "POST",
    token: fresh,
    body: {
      events: [
        {
          kind: "answer",
          id: randomUUID(),
          attemptId: attempt.json?.attemptId,
          questionId: q1?.id,
          payload: await encryptAnswer(pkg.json?.publicKeyPem, pkg.json?.keyVersion, "opt-2"),
          clientTs: Date.now(),
        },
        progressEvent(pid(1), Date.now()),
      ],
    },
  });
  const mixedOutcomes = mixed.json?.results?.map((r: any) => r.outcome);
  check(
    "6b. mixed batch (answer + progress) → both merged, input order kept",
    JSON.stringify(mixedOutcomes) === '["merged","merged"]',
    String(mixedOutcomes),
  );

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** STORAGE_DIR exactly as the backend resolves it (cwd-relative .env value). */
function readEnvStorageDir(): string {
  let dir = process.env.STORAGE_DIR;
  if (!dir) {
    try {
      const env = readFileSync(join(process.cwd(), ".env"), "utf8");
      dir = /^STORAGE_DIR=(.+)$/m.exec(env)?.[1]?.trim();
    } catch {
      /* fall through */
    }
  }
  dir = dir ?? ".storage";
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}

main().catch((err) => {
  console.error("verify-courses crashed:", err);
  process.exitCode = 1;
});
