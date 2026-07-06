import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { ScopeLevel } from "@rl/schemas";
import { PrismaService } from "../../platform/prisma.service";
import type { Scope } from "../../generated/prisma/client";

export interface ScopeRow {
  id: string;
  name: string;
  level: ScopeLevel;
  created_at: Date;
  depth: number;
}

/**
 * Closure-table access. All raw SQL fully qualifies table names
 * (org.scopes / org.scope_hierarchy) — the blueprint's hard-won lesson.
 */
@Injectable()
export class OrgHierarchyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findScopeById(id: string): Promise<Scope | null> {
    return this.prisma.client.scope.findUnique({ where: { id } });
  }

  /**
   * Insert scope + self-row + one closure row per ancestor of the parent, in
   * ONE transaction on the shared pg.Pool.
   */
  async insertScope(input: {
    name: string;
    level: ScopeLevel;
    parentId: string | null;
  }): Promise<{ id: string; createdAt: Date }> {
    const id = randomUUID();
    const client = await this.prisma.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ created_at: Date }>(
        `INSERT INTO org.scopes (id, name, level)
         VALUES ($1, $2, $3::org.scope_level)
         RETURNING created_at`,
        [id, input.name, input.level],
      );
      // Self-row: every node is its own ancestor at depth 0.
      await client.query(
        `INSERT INTO org.scope_hierarchy (ancestor_id, descendant_id, depth)
         VALUES ($1, $1, 0)`,
        [id],
      );
      if (input.parentId) {
        // The new node inherits every ancestor of its parent, one level deeper.
        await client.query(
          `INSERT INTO org.scope_hierarchy (ancestor_id, descendant_id, depth)
           SELECT ancestor_id, $1::uuid, depth + 1
           FROM org.scope_hierarchy
           WHERE descendant_id = $2::uuid`,
          [id, input.parentId],
        );
      }
      await client.query("COMMIT");
      return { id, createdAt: inserted.rows[0]!.created_at };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Whole subtree (root at depth 0) — single non-recursive index-scan join. */
  async getSubtree(rootId: string): Promise<ScopeRow[]> {
    const result = await this.prisma.pool.query<ScopeRow>(
      `SELECT s.id, s.name, s.level, s.created_at, sh.depth
       FROM org.scope_hierarchy sh
       JOIN org.scopes s ON s.id = sh.descendant_id
       WHERE sh.ancestor_id = $1::uuid
       ORDER BY sh.depth ASC, s.name ASC`,
      [rootId],
    );
    return result.rows;
  }

  /** Ancestors ordered by depth DESC (Central first) down to self (depth 0). */
  async getBreadcrumb(scopeId: string): Promise<ScopeRow[]> {
    const result = await this.prisma.pool.query<ScopeRow>(
      `SELECT s.id, s.name, s.level, s.created_at, sh.depth
       FROM org.scope_hierarchy sh
       JOIN org.scopes s ON s.id = sh.ancestor_id
       WHERE sh.descendant_id = $1::uuid
       ORDER BY sh.depth DESC`,
      [scopeId],
    );
    return result.rows;
  }

  /** Is `ancestorId` an ancestor of (or equal to) `descendantId`? */
  async isAncestorOrSelf(ancestorId: string, descendantId: string): Promise<boolean> {
    const result = await this.prisma.pool.query(
      `SELECT 1
       FROM org.scope_hierarchy
       WHERE ancestor_id = $1::uuid AND descendant_id = $2::uuid
       LIMIT 1`,
      [ancestorId, descendantId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** All descendant ids of a scope (includes the scope itself). */
  async getDescendantIds(scopeId: string): Promise<string[]> {
    const result = await this.prisma.pool.query<{ descendant_id: string }>(
      `SELECT descendant_id
       FROM org.scope_hierarchy
       WHERE ancestor_id = $1::uuid`,
      [scopeId],
    );
    return result.rows.map((row) => row.descendant_id);
  }
}
