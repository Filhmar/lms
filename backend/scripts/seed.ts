/**
 * Idempotent Phase I seed (run with: pnpm seed  /  npx tsx scripts/seed.ts).
 *
 * Seeds the DepEd demo chain used by the frontend fixtures:
 *   Central Office → Region IV-A → Division of Cavite → Dasmariñas District
 *   → San Isidro NHS
 * plus a central admin and the demo student Ana Reyes.
 *
 * Uses the raw pg driver (fully qualified table names) + Argon2id hashes.
 */
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { Pool } from "pg";
import { loadDotEnv } from "../src/platform/config";

// Fixed UUIDs make the seed idempotent and the demo chain addressable.
const SCOPES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "DepEd Central Office", level: "central", parent: null },
  { id: "22222222-2222-4222-8222-222222222222", name: "Region IV-A", level: "region", parent: "11111111-1111-4111-8111-111111111111" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Division of Cavite", level: "division", parent: "22222222-2222-4222-8222-222222222222" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Dasmariñas District", level: "district", parent: "33333333-3333-4333-8333-333333333333" },
  { id: "55555555-5555-4555-8555-555555555555", name: "San Isidro NHS", level: "school", parent: "44444444-4444-4444-8444-444444444444" },
] as const;

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
      },
      {
        email: "ana.reyes@deped.gov.ph",
        fullName: "Ana Reyes",
        role: "student",
        scopeId: SCOPES[4].id,
        password: "Student!2026",
      },
    ];

    for (const user of users) {
      const passwordHash = await argon2.hash(user.password, { type: argon2.argon2id });
      await client.query(
        `INSERT INTO auth.users (id, email, full_name, role, scope_id, status, password_hash)
         VALUES ($1, $2, $3, $4::auth.user_role, $5, 'active'::auth.user_status, $6)
         ON CONFLICT (email) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               role = EXCLUDED.role,
               scope_id = EXCLUDED.scope_id,
               status = EXCLUDED.status,
               password_hash = EXCLUDED.password_hash`,
        [randomUUID(), user.email, user.fullName, user.role, user.scopeId, passwordHash],
      );
    }

    await client.query("COMMIT");
    console.log("Seed complete:");
    for (const scope of SCOPES) console.log(`  scope ${scope.level.padEnd(8)} ${scope.name} (${scope.id})`);
    for (const user of users) console.log(`  user  ${user.role.padEnd(13)} ${user.email}`);
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
