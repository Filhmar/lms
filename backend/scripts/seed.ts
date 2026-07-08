/**
 * Idempotent Phase I–IV seed (run with: pnpm seed  /  npx tsx scripts/seed.ts).
 *
 * Seeds the DepEd demo chain used by the frontend fixtures:
 *   Central Office → Region IV-A → Division of Cavite → Dasmariñas District
 *   → San Isidro NHS (+ sibling Salawag NHS for lateral-isolation checks)
 * plus a central admin, the demo student Ana Reyes (San Isidro), the demo
 * student Jose Rizal (Salawag), the published Phase II exam
 * "Science 8 · Quarter 2 Periodical" (12 items, 30 min) owned by San Isidro,
 * the published Phase III course "Science 8" (3 chapters, 12 pages —
 * text/markdown + one video asset via the ObjectStorage port + one
 * assessment_embed referencing the seeded exam), same owner scope, and the
 * Phase IV pieces: Ed25519 issuer key v1 + the design's demo certificate
 * pair for Ana (8KX2-94QF active / 8KX2-94QG revoked) + her exam badge when
 * the attempt is already graded — all via the real issuance code path.
 *
 * Uses the raw pg driver (fully qualified table names) + Argon2id hashes.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import * as argon2 from "argon2";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { loadDotEnv } from "../src/platform/config";
import type { ConfigService } from "../src/platform/config";
import { LocalFsStorage } from "../src/platform/storage/local-fs.driver";
// Pure node:crypto helpers (no Nest wiring) — scripts import them directly.
import { generateExamKeyPair } from "../src/modules/cbt/exam-crypto";
import {
  ensureIssuerKeyV1,
  issueBadgeForGradedAttempt,
  issueCredential,
} from "../src/modules/credentials/issue-credential";

// Fixed UUIDs make the seed idempotent and the demo chain addressable.
const SCOPES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "DepEd Central Office", level: "central", parent: null },
  { id: "22222222-2222-4222-8222-222222222222", name: "Region IV-A", level: "region", parent: "11111111-1111-4111-8111-111111111111" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Division of Cavite", level: "division", parent: "22222222-2222-4222-8222-222222222222" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Dasmariñas District", level: "district", parent: "33333333-3333-4333-8333-333333333333" },
  { id: "55555555-5555-4555-8555-555555555555", name: "San Isidro NHS", level: "school", parent: "44444444-4444-4444-8444-444444444444" },
  // Sibling school in the same district — laterally isolated from San Isidro.
  { id: "99999999-9999-4999-8999-999999999999", name: "Salawag NHS", level: "school", parent: "44444444-4444-4444-8444-444444444444" },
] as const;

/* ----------------------- Phase II — demo CBT exam ----------------------- */

const EXAM_ID = "c0ffee00-0000-4000-8000-00000000cb70";
const qid = (n: number) => `c0ffee00-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

const MCQ_TF_OPTIONS = {
  /** mcq options get stable ids opt-1..opt-n in fixture order. */
  mcq: (texts: string[]) => texts.map((text, i) => ({ id: `opt-${i + 1}`, text })),
  tf: [
    { id: "true", text: "True" },
    { id: "false", text: "False" },
  ],
};

/**
 * EXACT 12 questions from frontend/lib/fixtures.ts. `correct` NEVER leaves
 * the server: mcq/tf → the correct option id; ident → accepted strings
 * (matched case/whitespace-insensitively by the grading worker).
 */
const EXAM_QUESTIONS = [
  { seq: 1, type: "mcq", text: "Which of the following is a renewable source of energy?", options: MCQ_TF_OPTIONS.mcq(["Coal", "Solar energy", "Natural gas", "Diesel"]), correct: "opt-2" },
  { seq: 2, type: "mcq", text: "What gas do plants release during photosynthesis?", options: MCQ_TF_OPTIONS.mcq(["Carbon dioxide", "Nitrogen", "Oxygen", "Methane"]), correct: "opt-3" },
  { seq: 3, type: "tf", text: "True or false: the Philippines lies within the Pacific Ring of Fire.", options: MCQ_TF_OPTIONS.tf, correct: "true" },
  { seq: 4, type: "mcq", text: "Which cloud type usually brings thunderstorms?", options: MCQ_TF_OPTIONS.mcq(["Cirrus", "Cumulonimbus", "Stratus", "Altocumulus"]), correct: "opt-2" },
  { seq: 5, type: "ident", text: "What instrument is used to measure air pressure?", options: null, correct: ["barometer"] },
  { seq: 6, type: "mcq", text: "Which enzyme in saliva begins the digestion of starch?", options: MCQ_TF_OPTIONS.mcq(["Pepsin", "Lipase", "Amylase", "Trypsin"]), correct: "opt-3" },
  { seq: 7, type: "tf", text: "True or false: sound travels faster in water than in air.", options: MCQ_TF_OPTIONS.tf, correct: "true" },
  { seq: 8, type: "mcq", text: "Which is an example of Newton's third law of motion?", options: MCQ_TF_OPTIONS.mcq(["A book resting on a table", "A rocket pushing exhaust down and rising up", "A ball rolling down a hill", "A magnet attracting iron"]), correct: "opt-2" },
  { seq: 9, type: "mcq", text: "What is the chemical symbol of iron?", options: MCQ_TF_OPTIONS.mcq(["Ir", "In", "Fe", "I"]), correct: "opt-3" },
  { seq: 10, type: "ident", text: "Name the outermost layer of the Earth.", options: null, correct: ["crust"] },
  { seq: 11, type: "mcq", text: "In a flashlight, electrical energy is mainly transformed into…", options: MCQ_TF_OPTIONS.mcq(["Sound and heat", "Light and heat", "Motion and sound", "Chemical energy"]), correct: "opt-2" },
  { seq: 12, type: "tf", text: "True or false: the Sun is a planet.", options: MCQ_TF_OPTIONS.tf, correct: "false" },
] as const;

/**
 * Publish the demo exam owned by San Isidro NHS: opens now-1h, closes
 * now+30d, 30 minutes, key_version 1. Idempotent: the RSA keypair is
 * generated ONCE (first run) and kept on re-runs — regenerating would orphan
 * envelopes already encrypted against the published public key; the window
 * is refreshed each run so the demo always has an open exam.
 */
async function seedExam(client: PoolClient, createdBy: string): Promise<void> {
  const existing = await client.query(
    `SELECT id FROM cbt.exams WHERE id = $1::uuid`,
    [EXAM_ID],
  );
  if (existing.rowCount === 0) {
    const { publicKeyPem, privateKeyPem } = generateExamKeyPair();
    await client.query(
      `INSERT INTO cbt.exams
         (id, title, owner_scope_id, status, version, duration_minutes,
          opens_at, closes_at, key_version, public_key_pem, private_key_pem, created_by)
       VALUES ($1, $2, $3, 'published', 1, 30,
               now() - interval '1 hour', now() + interval '30 days',
               1, $4, $5, $6)`,
      [EXAM_ID, "Science 8 · Quarter 2 Periodical", SCOPES[4].id, publicKeyPem, privateKeyPem, createdBy],
    );
  } else {
    await client.query(
      `UPDATE cbt.exams
       SET title = $2, status = 'published', duration_minutes = 30,
           opens_at = now() - interval '1 hour',
           closes_at = now() + interval '30 days'
       WHERE id = $1::uuid`,
      [EXAM_ID, "Science 8 · Quarter 2 Periodical"],
    );
  }

  for (const q of EXAM_QUESTIONS) {
    await client.query(
      `INSERT INTO cbt.questions (id, exam_id, seq, type, text, options, correct, weight)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 1)
       ON CONFLICT (id) DO UPDATE
         SET seq = EXCLUDED.seq, type = EXCLUDED.type, text = EXCLUDED.text,
             options = EXCLUDED.options, correct = EXCLUDED.correct,
             weight = EXCLUDED.weight`,
      [
        qid(q.seq),
        EXAM_ID,
        q.seq,
        q.type,
        q.text,
        q.options === null ? null : JSON.stringify(q.options),
        JSON.stringify(q.correct),
      ],
    );
  }
}

/* --------------------- Phase III — demo Science 8 course --------------------- */

// Fixed, addressable ids (same trick as the exam): version nibble 4,
// variant nibble 8, hex-only tails — course cc, chapter c<n>ff, page c<n><pp>.
const COURSE_ID = "c0a15e00-0000-4000-8000-0000000000cc";
const chapterUuid = (ch: number) => `c0a15e00-0000-4000-8000-00000000c${ch}ff`;
const pageUuid = (ch: number, page: number) =>
  `c0a15e00-0000-4000-8000-00000000c${ch}${String(page).padStart(2, "0")}`;

const VIDEO_ASSET_KEY = "ch3-community-preparedness.mp4";

interface SeedPage {
  seq: number;
  type: "text_content" | "video" | "assessment_embed";
  title: string;
  body?: string;
  examId?: string;
}

/** Chapter/page structure mirrors the design demo
 *  (frontend/app/courses/course-shared.tsx): Ch1–2 short readings, Ch3
 *  "Weather disturbances" = the five demo reading pages + the chapter-check
 *  assessment (page 6, embedding the seeded exam) + one video page. */
const COURSE_CHAPTERS: Array<{ ch: number; title: string; pages: SeedPage[] }> = [
  {
    ch: 1,
    title: "Earthquakes and faults",
    pages: [
      {
        seq: 1,
        type: "text_content",
        title: "Why the ground shakes",
        body: [
          "# Why the ground shakes",
          "",
          "The Earth's crust is broken into large plates that move slowly past each other. When two blocks of rock suddenly slip along a **fault**, the energy released travels as waves — that is an earthquake.",
          "",
          "The Philippines sits where several plates meet, which is why we feel earthquakes often.",
        ].join("\n"),
      },
      {
        seq: 2,
        type: "text_content",
        title: "Faults in the Philippines",
        body: [
          "# Faults in the Philippines",
          "",
          "A fault is a crack in the crust where rock can move. The **Philippine Fault Zone** runs the length of the country, and the **Valley Fault System** passes near Metro Manila.",
          "",
          "- *Active faults* have moved in recent history and can move again.",
          "- *Inactive faults* show no recent movement.",
          "",
          "PHIVOLCS publishes fault maps so communities know what is under their feet.",
        ].join("\n"),
      },
      {
        seq: 3,
        type: "text_content",
        title: "Duck, cover, and hold",
        body: [
          "# Duck, cover, and hold",
          "",
          "When shaking starts: **duck** under a sturdy table, **cover** your head and neck, and **hold** on until the shaking stops.",
          "",
          "After the shaking, move calmly to an open area. Expect aftershocks — they are smaller quakes that follow the main one.",
        ].join("\n"),
      },
    ],
  },
  {
    ch: 2,
    title: "Typhoons",
    pages: [
      {
        seq: 1,
        type: "text_content",
        title: "The Philippine Area of Responsibility",
        body: [
          "# The Philippine Area of Responsibility",
          "",
          "The **PAR** is the region of the Pacific that PAGASA watches. Once a tropical cyclone crosses into the PAR it receives a local name, and PAGASA begins issuing bulletins for it.",
          "",
          "About twenty tropical cyclones enter the PAR every year; eight or nine make landfall.",
        ].join("\n"),
      },
      {
        seq: 2,
        type: "text_content",
        title: "Anatomy of a typhoon",
        body: [
          "# Anatomy of a typhoon",
          "",
          "A typhoon has three parts:",
          "",
          "1. The **eye** — a calm, clear center.",
          "2. The **eyewall** — the ring of the strongest wind and rain.",
          "3. The **rainbands** — spiral arms that can stretch hundreds of kilometers.",
          "",
          "The calm of the eye can fool people into going outside — the other side of the eyewall arrives quickly.",
        ].join("\n"),
      },
    ],
  },
  {
    ch: 3,
    title: "Weather disturbances",
    pages: [
      {
        seq: 1,
        type: "text_content",
        title: "What is a tropical cyclone?",
        body: [
          "# What is a tropical cyclone?",
          "",
          "A tropical cyclone is a large rotating storm that forms over warm ocean water. In the Philippines we call the strongest ones **bagyo**.",
          "",
          "Every year, about twenty tropical cyclones enter the Philippine Area of Responsibility.",
        ].join("\n"),
      },
      {
        seq: 2,
        type: "text_content",
        title: "How typhoons form",
        body: [
          "# How typhoons form",
          "",
          "Warm, moist air rises from the sea surface and cooler air rushes in below it. As this cycle repeats, clouds spin into a huge rotating system.",
          "",
          "When winds near the center pass **118 km/h**, the storm is called a typhoon.",
        ].join("\n"),
      },
      {
        seq: 3,
        type: "text_content",
        title: "Reading the weather map",
        body: [
          "# Reading the weather map",
          "",
          "Weather maps show where a storm is, where it is heading, and how wide its winds reach. The **eye** of the storm sits at the center of the spiral.",
          "",
          "PAGASA updates the storm track several times a day while a cyclone is inside the Philippine Area of Responsibility.",
        ].join("\n"),
      },
      {
        seq: 4,
        type: "text_content",
        title: "Rainfall and flooding",
        body: [
          "# Rainfall and flooding",
          "",
          "A slow-moving storm can drop more rain than a fast one, even when its winds are weaker. Low-lying communities watch rainfall warnings closely.",
          "",
          "Know where your barangay's evacuation center is **before** the rain starts.",
        ].join("\n"),
      },
      {
        seq: 5,
        type: "text_content",
        title: "Storm signals",
        body: [
          "# Public storm warning signals",
          "",
          "When a tropical cyclone approaches, PAGASA raises wind signals from 1 to 5. Each signal tells your community how strong winds may get — and how much time you have to prepare.",
          "",
          "| Signal | Winds expected | Lead time |",
          "| --- | --- | --- |",
          "| **No. 1** | 39–61 km/h | within 36 hours |",
          "| **No. 2** | 62–88 km/h | within 24 hours |",
          "| **No. 3** | 89–117 km/h | within 18 hours |",
          "| **No. 4** | 118–184 km/h | within 12 hours |",
          "| **No. 5** | 185 km/h and above | within 12 hours |",
          "",
          "Classes in your area are suspended automatically at Signal No. 1 for preschool, and higher signals suspend higher levels — listen for your local announcement.",
        ].join("\n"),
      },
      {
        seq: 6,
        type: "assessment_embed",
        title: "Chapter check: Quarter 2 Periodical",
        examId: EXAM_ID,
      },
      {
        seq: 7,
        type: "video",
        title: "Community preparedness",
        // video_* columns are filled from the stored asset in seedCourse.
      },
    ],
  },
];

/**
 * Course video asset: a tiny real MP4 when ffmpeg is available; otherwise an
 * MP4-shaped placeholder binary (valid ftyp header, no playable track) —
 * real media arrives with the Phase III media pipeline, and the player's
 * "not available" state handles a non-decodable asset gracefully.
 */
function buildVideoAsset(): { data: Buffer; real: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "rl-seed-"));
  const out = join(dir, "seed.mp4");
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "lavfi",
       "-i", "smptebars=size=320x180:rate=12:duration=2",
       "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", out],
      { stdio: "ignore" },
    );
    return { data: readFileSync(out), real: true };
  } catch {
    const ftyp = Buffer.concat([
      Buffer.from([0, 0, 0, 24]), // box size
      Buffer.from("ftypisom", "ascii"), // 'ftyp', major brand isom
      Buffer.from([0, 0, 2, 0]), // minor version
      Buffer.from("isommp41", "ascii"), // compatible brands
    ]);
    const note = Buffer.from(
      "Resilient-Learn placeholder video asset — real media arrives with the Phase III media pipeline.",
      "utf8",
    );
    const free = Buffer.alloc(8 + note.length);
    free.writeUInt32BE(8 + note.length, 0);
    free.write("free", 4, "ascii");
    note.copy(free, 8);
    return { data: Buffer.concat([ftyp, free]), real: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Publish the demo course owned by San Isidro NHS (same scope as the exam).
 * Idempotent: fixed ids upserted every run; the video asset is (re)written
 * through the ObjectStorage port so video_size_bytes always matches the
 * stored bytes exactly.
 */
async function seedCourse(
  client: PoolClient,
  createdBy: string,
): Promise<{ pages: number; videoBytes: number; realVideo: boolean }> {
  // Storage goes through the port (local-fs driver), never fs paths directly.
  // Minimal config shim: the driver only reads config.storageDir, and the
  // full loadConfig() would demand JWT keys this script doesn't need.
  const storageDir = process.env.STORAGE_DIR ?? ".storage";
  const storage = new LocalFsStorage({
    config: { storageDir: isAbsolute(storageDir) ? storageDir : resolve(process.cwd(), storageDir) },
  } as unknown as ConfigService);
  const video = buildVideoAsset();
  await storage.put(`courses/${COURSE_ID}/${VIDEO_ASSET_KEY}`, video.data);

  await client.query(
    `INSERT INTO courses.courses (id, title, subject, owner_scope_id, status, version, created_by)
     VALUES ($1, $2, $3, $4, 'published', 1, $5)
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title, subject = EXCLUDED.subject,
           owner_scope_id = EXCLUDED.owner_scope_id, status = 'published'`,
    [COURSE_ID, "Science 8", "Science 8", SCOPES[4].id, createdBy],
  );

  let pages = 0;
  for (const chapter of COURSE_CHAPTERS) {
    await client.query(
      `INSERT INTO courses.chapters (id, course_id, seq, title)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET seq = EXCLUDED.seq, title = EXCLUDED.title`,
      [chapterUuid(chapter.ch), COURSE_ID, chapter.ch, chapter.title],
    );
    for (const page of chapter.pages) {
      const isVideo = page.type === "video";
      await client.query(
        `INSERT INTO courses.pages
           (id, chapter_id, seq, type, title, body,
            video_asset_key, video_size_bytes, video_duration_label, exam_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE
           SET seq = EXCLUDED.seq, type = EXCLUDED.type, title = EXCLUDED.title,
               body = EXCLUDED.body, video_asset_key = EXCLUDED.video_asset_key,
               video_size_bytes = EXCLUDED.video_size_bytes,
               video_duration_label = EXCLUDED.video_duration_label,
               exam_id = EXCLUDED.exam_id`,
        [
          pageUuid(chapter.ch, page.seq),
          chapterUuid(chapter.ch),
          page.seq,
          page.type,
          page.title,
          page.body ?? null,
          isVideo ? VIDEO_ASSET_KEY : null,
          isVideo ? video.data.length : null,
          isVideo ? "0:02" : null,
          // Validated on write (no cross-schema FK): the referenced exam is
          // seeded above in this same transaction.
          page.examId ?? null,
        ],
      );
      pages += 1;
    }
  }
  return { pages, videoBytes: video.data.length, realVideo: video.real };
}

/* ------------------- Phase IV — demo credentials (design) ------------------- */

const DEMO_CERT_ACTIVE = { controlNo: "2026-04-118203", verifyCode: "8KX2-94QF" };
const DEMO_CERT_REVOKED = { controlNo: "2026-04-118204", verifyCode: "8KX2-94QG" };
const DEMO_REVOKE_REASON = "Issued in error — duplicate record";

/**
 * Phase IV seed: ensure Ed25519 issuer key v1, then (deterministically —
 * skipped when the fixed codes already exist) force-issue the design's demo
 * pair for Ana: the "Grade 7 Completion" certificate 8KX2-94QF (active,
 * control 2026-04-118203) and its revoked duplicate 8KX2-94QG. Finally, if
 * Ana's attempt on the seeded exam is already graded, issue her badge via
 * the SAME issuance path the grading worker uses (idempotent).
 */
async function seedCredentials(client: PoolClient): Promise<string[]> {
  const notes: string[] = [];
  const verifyBase = (process.env.VERIFY_PUBLIC_BASE ?? "http://localhost:3000/verify")
    .replace(/\/+$/, "");
  const key = await ensureIssuerKeyV1(client);
  notes.push("issuer key v1 (Ed25519) present");

  const ana = await client.query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM auth.users WHERE email = 'ana.reyes@deped.gov.ph'`,
  );
  const anaRow = ana.rows[0];
  if (!anaRow) return notes;

  const existing = await client.query(
    `SELECT 1 FROM creds.credentials WHERE verify_code = ANY($1::text[])`,
    [[DEMO_CERT_ACTIVE.verifyCode, DEMO_CERT_REVOKED.verifyCode]],
  );
  if (existing.rowCount === 0) {
    const base = {
      userId: anaRow.id,
      kind: "certificate" as const,
      title: "Grade 7 Completion",
      holderName: anaRow.full_name,
      issuedScopeId: SCOPES[4].id, // San Isidro NHS
      snapshotExtra: { courseTitle: "Grade 7 Completion", demo: true },
      key,
      verifyBase,
    };
    await issueCredential(client, { ...base, forced: DEMO_CERT_ACTIVE });
    const dup = await issueCredential(client, { ...base, forced: DEMO_CERT_REVOKED });
    if (dup) {
      // Revoke the duplicate exactly like the admin endpoint: registry +
      // read model + audit together (this whole seed runs in one tx).
      await client.query(
        `UPDATE creds.credentials
         SET status = 'revoked', revoked_reason = $2, revoked_at = now()
         WHERE id = $1::uuid`,
        [dup.id, DEMO_REVOKE_REASON],
      );
      await client.query(
        `UPDATE creds.verify_read SET status = 'revoked' WHERE verify_code = $1`,
        [dup.verifyCode],
      );
      await client.query(
        `INSERT INTO creds.audit (credential_id, action, actor_user_id, reason)
         VALUES ($1::uuid, 'revoked', NULL, $2)`,
        [dup.id, DEMO_REVOKE_REASON],
      );
    }
    notes.push(
      `demo certificates ${DEMO_CERT_ACTIVE.verifyCode} (active) + ${DEMO_CERT_REVOKED.verifyCode} (revoked)`,
    );
  } else {
    notes.push("demo certificates already present — skipped");
  }

  // Badge for Ana's graded attempt (if any) — the grading worker's own path.
  const attempt = await client.query<{ id: string }>(
    `SELECT id FROM cbt.attempts
     WHERE exam_id = $1::uuid AND user_id = $2::uuid AND state = 'graded'`,
    [EXAM_ID, anaRow.id],
  );
  if (attempt.rows[0]) {
    const badge = await issueBadgeForGradedAttempt(
      client,
      attempt.rows[0].id,
      key,
      verifyBase,
    );
    notes.push(
      badge
        ? `exam badge issued for Ana (${badge.verifyCode})`
        : "exam badge for Ana already present — skipped",
    );
  }
  return notes;
}

async function main(): Promise<void> {
  loadDotEnv(process.cwd());
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // --- scopes + closure rows (self + every ancestor) --------------------
    for (const scope of SCOPES) {
      await client.query(
        `INSERT INTO org.scopes (id, name, level)
         VALUES ($1, $2, $3::org.scope_level)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [scope.id, scope.name, scope.level],
      );
    }

    // Build ancestor chains from the fixed parent links.
    const parentOf = new Map<string, string | null>(
      SCOPES.map((s) => [s.id, s.parent]),
    );
    for (const scope of SCOPES) {
      let ancestor: string | null = scope.id;
      let depth = 0;
      while (ancestor) {
        await client.query(
          `INSERT INTO org.scope_hierarchy (ancestor_id, descendant_id, depth)
           VALUES ($1, $2, $3)
           ON CONFLICT (ancestor_id, descendant_id) DO UPDATE SET depth = EXCLUDED.depth`,
          [ancestor, scope.id, depth],
        );
        ancestor = parentOf.get(ancestor) ?? null;
        depth += 1;
      }
    }

    // --- users -------------------------------------------------------------
    const users = [
      {
        email: "admin@deped.gov.ph",
        fullName: "System Administrator",
        role: "central_admin",
        scopeId: SCOPES[0].id,
        password: "ChangeMe!2026",
        phone: "+639170000001",
      },
      {
        email: "ana.reyes@deped.gov.ph",
        fullName: "Ana Reyes",
        role: "student",
        scopeId: SCOPES[4].id,
        password: "Student!2026",
        phone: "+639170000002",
      },
      // Salawag student — must NOT see San Isidro's exam (lateral isolation).
      {
        email: "jose.rizal@deped.gov.ph",
        fullName: "Jose Rizal",
        role: "student",
        scopeId: SCOPES[5].id,
        password: "Student!2026",
        phone: "+639170000003",
      },
    ];

    for (const user of users) {
      const passwordHash = await argon2.hash(user.password, { type: argon2.argon2id });
      await client.query(
        `INSERT INTO auth.users (id, email, full_name, role, scope_id, status, password_hash, phone)
         VALUES ($1, $2, $3, $4::auth.user_role, $5, 'active'::auth.user_status, $6, $7)
         ON CONFLICT (email) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               role = EXCLUDED.role,
               scope_id = EXCLUDED.scope_id,
               status = EXCLUDED.status,
               password_hash = EXCLUDED.password_hash,
               phone = EXCLUDED.phone`,
        [randomUUID(), user.email, user.fullName, user.role, user.scopeId, passwordHash, user.phone],
      );
    }

    // --- Phase II exam (owned by San Isidro NHS, created by the admin) -----
    const admin = await client.query<{ id: string }>(
      `SELECT id FROM auth.users WHERE email = 'admin@deped.gov.ph'`,
    );
    await seedExam(client, admin.rows[0]!.id);

    // --- Phase III course (same owner scope as the exam) --------------------
    const course = await seedCourse(client, admin.rows[0]!.id);

    // --- Phase IV issuer key + demo credentials ------------------------------
    const credNotes = await seedCredentials(client);

    await client.query("COMMIT");
    console.log("Seed complete:");
    for (const scope of SCOPES) console.log(`  scope ${scope.level.padEnd(8)} ${scope.name} (${scope.id})`);
    for (const user of users) console.log(`  user  ${user.role.padEnd(13)} ${user.email}`);
    console.log(`  exam  published     Science 8 · Quarter 2 Periodical (${EXAM_ID}, 12 items, 30 min)`);
    console.log(
      `  course published    Science 8 (${COURSE_ID}, ${COURSE_CHAPTERS.length} chapters, ${course.pages} pages, ` +
        `video asset ${course.videoBytes} bytes${course.realVideo ? "" : " — placeholder binary; real media arrives with the media pipeline"})`,
    );
    for (const note of credNotes) console.log(`  creds ${note}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exitCode = 1;
});
