/**
 * Idempotent Phase I+II seed (run with: pnpm seed  /  npx tsx scripts/seed.ts).
 *
 * Seeds the DepEd demo chain used by the frontend fixtures:
 *   Central Office → Region IV-A → Division of Cavite → Dasmariñas District
 *   → San Isidro NHS (+ sibling Salawag NHS for lateral-isolation checks)
 * plus a central admin, the demo student Ana Reyes (San Isidro), the demo
 * student Jose Rizal (Salawag), and the published Phase II exam
 * "Science 8 · Quarter 2 Periodical" (12 items, 30 min) owned by San Isidro.
 *
 * Uses the raw pg driver (fully qualified table names) + Argon2id hashes.
 */
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { loadDotEnv } from "../src/platform/config";
// Pure node:crypto helper (no Nest wiring) — scripts import it directly.
import { generateExamKeyPair } from "../src/modules/cbt/exam-crypto";

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

    await client.query("COMMIT");
    console.log("Seed complete:");
    for (const scope of SCOPES) console.log(`  scope ${scope.level.padEnd(8)} ${scope.name} (${scope.id})`);
    for (const user of users) console.log(`  user  ${user.role.padEnd(13)} ${user.email}`);
    console.log(`  exam  published     Science 8 · Quarter 2 Periodical (${EXAM_ID}, 12 items, 30 min)`);
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
