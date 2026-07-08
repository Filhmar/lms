import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../platform/prisma.service";

/* ------------------------------ row shapes ------------------------------ */

export interface CredentialRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  monogram: string;
  control_no: string;
  verify_code: string;
  exam_id: string | null;
  course_id: string | null;
  issued_scope_id: string;
  issuer_line: string;
  metadata_snapshot: Record<string, unknown>;
  vc: Record<string, unknown>;
  assertion_hash: string;
  key_version: number;
  status: string;
  revoked_reason: string | null;
  revoked_at: Date | null;
  issued_at: Date;
}

export interface AdminCredentialRow extends CredentialRow {
  /** Live name when the user still exists, else the snapshot's. */
  holder_name: string;
}

export interface VerifyReadRow {
  verify_code: string;
  status: string;
  masked_name: string;
  title: string;
  issuer_line: string;
  issued_at: Date;
  control_no: string;
  assertion_hash: string;
  vc: Record<string, unknown>;
  key_version: number;
}

const CREDENTIAL_COLUMNS = `
  c.id, c.user_id, c.kind, c.title, c.monogram, c.control_no, c.verify_code,
  c.exam_id, c.course_id, c.issued_scope_id, c.issuer_line,
  c.metadata_snapshot, c.vc, c.assertion_hash, c.key_version, c.status,
  c.revoked_reason, c.revoked_at, c.issued_at`;

/**
 * Credentials data access — raw SQL on the shared pg.Pool, fully-qualified
 * creds.* tables. Revoke/restore mutate creds.credentials AND the
 * creds.verify_read read model AND creds.audit in one transaction: the
 * verify portal must never disagree with the registry.
 */
@Injectable()
export class CredentialsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The holder's wallet, newest first. */
  async listByUser(userId: string): Promise<CredentialRow[]> {
    const result = await this.prisma.pool.query<CredentialRow>(
      `SELECT ${CREDENTIAL_COLUMNS}
       FROM creds.credentials c
       WHERE c.user_id = $1::uuid
       ORDER BY c.issued_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async findById(id: string): Promise<CredentialRow | null> {
    const result = await this.prisma.pool.query<CredentialRow>(
      `SELECT ${CREDENTIAL_COLUMNS}
       FROM creds.credentials c
       WHERE c.id = $1::uuid`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Admin oversight list: credentials issued by any scope in the subtree
   * under `scopeId` (downward inheritance via the closure table), holder
   * names included — admins see names; only the PUBLIC portal masks.
   */
  async listForScopeSubtree(
    scopeId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: AdminCredentialRow[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.prisma.pool.query<AdminCredentialRow>(
        `SELECT ${CREDENTIAL_COLUMNS},
                coalesce(u.full_name, c.metadata_snapshot->>'holderName') AS holder_name
         FROM creds.credentials c
         JOIN org.scope_hierarchy sh
           ON sh.ancestor_id = $1::uuid AND sh.descendant_id = c.issued_scope_id
         LEFT JOIN auth.users u ON u.id = c.user_id
         ORDER BY c.issued_at DESC, c.id DESC
         LIMIT $2 OFFSET $3`,
        [scopeId, pageSize, (page - 1) * pageSize],
      ),
      this.prisma.pool.query<{ total: string }>(
        `SELECT count(*) AS total
         FROM creds.credentials c
         JOIN org.scope_hierarchy sh
           ON sh.ancestor_id = $1::uuid AND sh.descendant_id = c.issued_scope_id`,
        [scopeId],
      ),
    ]);
    return { rows: rows.rows, total: Number(count.rows[0]?.total ?? 0) };
  }

  /**
   * Revoke: registry + read model + audit atomically. Returns the updated
   * row, or null when the credential wasn't active (idempotence guard —
   * the service turns that into a 409).
   */
  async revoke(
    id: string,
    reason: string,
    actorUserId: string,
  ): Promise<CredentialRow | null> {
    return this.mutateStatus(id, {
      from: "active",
      to: "revoked",
      reason,
      actorUserId,
      action: "revoked",
    });
  }

  /** Restore: back to active; reason/revoked_at cleared; audit written. */
  async restore(id: string, actorUserId: string): Promise<CredentialRow | null> {
    return this.mutateStatus(id, {
      from: "revoked",
      to: "active",
      reason: null,
      actorUserId,
      action: "restored",
    });
  }

  private async mutateStatus(
    id: string,
    move: {
      from: string;
      to: string;
      reason: string | null;
      actorUserId: string;
      action: "revoked" | "restored";
    },
  ): Promise<CredentialRow | null> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<CredentialRow>(
        `UPDATE creds.credentials c
         SET status = $2,
             revoked_reason = $3,
             revoked_at = CASE WHEN $2 = 'revoked' THEN now() ELSE NULL END
         WHERE c.id = $1::uuid AND c.status = $4
         RETURNING ${CREDENTIAL_COLUMNS.replaceAll("c.", "")}`,
        [id, move.to, move.reason, move.from],
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE creds.verify_read SET status = $2 WHERE verify_code = $1`,
        [row.verify_code, move.to],
      );
      await client.query(
        `INSERT INTO creds.audit (credential_id, action, actor_user_id, reason)
         VALUES ($1::uuid, $2, $3::uuid, $4)`,
        [id, move.action, move.actorUserId, move.reason],
      );
      await client.query("COMMIT");
      return row;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Public verify lookup — the read model only, never the registry. */
  async findVerifyRead(verifyCode: string): Promise<VerifyReadRow | null> {
    const result = await this.prisma.pool.query<VerifyReadRow>(
      `SELECT verify_code, status, masked_name, title, issuer_line, issued_at,
              control_no, assertion_hash, vc, key_version
       FROM creds.verify_read
       WHERE verify_code = $1`,
      [verifyCode],
    );
    return result.rows[0] ?? null;
  }
}
