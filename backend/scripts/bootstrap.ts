/**
 * First-run bootstrap for REAL environments (staging/production), where the
 * demo seed never runs: creates the Central scope (if no central-level scope
 * exists) and creates/updates the central admin. Idempotent — safe to re-run.
 *
 * Required env: DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD,
 * BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PHONE (PH mobile).
 *
 * Run: pnpm run bootstrap  — or via compose:
 *   docker compose ... --profile bootstrap run --rm bootstrap
 */
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { Pool } from "pg";
import { normalizePhPhone } from "@rl/schemas";
import { loadDotEnv } from "../src/platform/config";

const CENTRAL_SCOPE_NAME = "DepEd Central Office";

async function main(): Promise<void> {
  loadDotEnv(process.cwd());

  const required = [
    "DATABASE_URL",
    "BOOTSTRAP_ADMIN_EMAIL",
    "BOOTSTRAP_ADMIN_PASSWORD",
    "BOOTSTRAP_ADMIN_NAME",
    "BOOTSTRAP_ADMIN_PHONE",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `Bootstrap needs these environment variables set: ${missing.join(", ")}.\n` +
        "Set them in the deploy env (.env.staging / .env.production) and re-run.",
    );
    process.exit(1);
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL!.toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD!;
  const fullName = process.env.BOOTSTRAP_ADMIN_NAME!;
  const phone = normalizePhPhone(process.env.BOOTSTRAP_ADMIN_PHONE!);
  if (!phone) {
    console.error(
      "BOOTSTRAP_ADMIN_PHONE must be a Philippine mobile (e.g. 09171234567).",
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Central scope: reuse the existing one if any central-level scope exists.
    const existing = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM org.scopes WHERE level = 'central'::org.scope_level
       ORDER BY created_at ASC LIMIT 1`,
    );
    let centralId: string;
    if (existing.rows[0]) {
      centralId = existing.rows[0].id;
      console.log(`Central scope exists: ${existing.rows[0].name} (${centralId})`);
    } else {
      centralId = randomUUID();
      await client.query(
        `INSERT INTO org.scopes (id, name, level)
         VALUES ($1, $2, 'central'::org.scope_level)`,
        [centralId, CENTRAL_SCOPE_NAME],
      );
      // Closure self-row: every node is its own ancestor at depth 0.
      await client.query(
        `INSERT INTO org.scope_hierarchy (ancestor_id, descendant_id, depth)
         VALUES ($1, $1, 0)`,
        [centralId],
      );
      console.log(`Created central scope: ${CENTRAL_SCOPE_NAME} (${centralId})`);
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const upserted = await client.query<{ id: string }>(
      `INSERT INTO auth.users (id, email, full_name, role, scope_id, status, password_hash, phone)
       VALUES ($1, $2, $3, 'central_admin'::auth.user_role, $4,
               'active'::auth.user_status, $5, $6)
       ON CONFLICT (email) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             role = EXCLUDED.role,
             scope_id = EXCLUDED.scope_id,
             status = EXCLUDED.status,
             password_hash = EXCLUDED.password_hash,
             phone = EXCLUDED.phone
       RETURNING id`,
      [randomUUID(), email, fullName, centralId, passwordHash, phone],
    );

    await client.query("COMMIT");
    console.log(`Central admin ready: ${email} (${upserted.rows[0]!.id})`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Bootstrap did not complete:", err);
  process.exitCode = 1;
});
