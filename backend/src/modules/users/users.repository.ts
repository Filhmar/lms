import { Injectable } from "@nestjs/common";
import type {
  ListUsersQuery,
  ScopeLevel,
  UserRole,
  UserStatus,
} from "@rl/schemas";
import { PrismaService } from "../../platform/prisma.service";

/** auth.users row joined with its org.scopes name/level. */
export interface UserWithScopeRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  scope_id: string;
  phone: string | null;
  created_at: Date;
  scope_name: string;
  scope_level: ScopeLevel;
}

export interface ScopeRow {
  id: string;
  name: string;
  level: ScopeLevel;
}

export interface ScopeStatsRow {
  total: number;
  active: number;
  pending_activation: number;
  disabled: number;
  students: number;
  teachers: number;
  child_scopes: number;
}

const SELECT_USER_WITH_SCOPE = `
  SELECT u.id, u.email, u.full_name, u.role, u.status, u.scope_id, u.phone,
         u.created_at, s.name AS scope_name, s.level AS scope_level
  FROM auth.users u
  JOIN org.scopes s ON s.id = u.scope_id`;

/** Escape LIKE metacharacters so a literal "%"/"_" in q stays literal. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

/**
 * Raw SQL fully qualified (auth.users / org.scopes / org.scope_hierarchy) on
 * the shared pg.Pool. Subtree listing joins the closure table — a single
 * non-recursive index scan, never a recursive CTE.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<UserWithScopeRow | null> {
    const result = await this.prisma.pool.query<UserWithScopeRow>(
      `${SELECT_USER_WITH_SCOPE} WHERE u.id = $1::uuid`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<{ id: string } | null> {
    const result = await this.prisma.pool.query<{ id: string }>(
      `SELECT id FROM auth.users WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findScope(scopeId: string): Promise<ScopeRow | null> {
    const result = await this.prisma.pool.query<ScopeRow>(
      `SELECT id, name, level FROM org.scopes WHERE id = $1::uuid`,
      [scopeId],
    );
    return result.rows[0] ?? null;
  }

  /** Filtered, paginated listing rooted at `scopeId` (exact or whole subtree). */
  async list(
    query: ListUsersQuery & { scopeId: string },
  ): Promise<{ rows: UserWithScopeRow[]; total: number }> {
    const params: unknown[] = [query.scopeId];
    // Root: closure-table join for the subtree, plain equality for one scope.
    const scopeClause = query.includeDescendants
      ? `u.scope_id IN (SELECT sh.descendant_id FROM org.scope_hierarchy sh
                        WHERE sh.ancestor_id = $1::uuid)`
      : `u.scope_id = $1::uuid`;
    const where: string[] = [scopeClause];

    if (query.role) {
      params.push(query.role);
      where.push(`u.role = $${params.length}::auth.user_role`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`u.status = $${params.length}::auth.user_status`);
    }
    if (query.q) {
      params.push(`%${escapeLike(query.q)}%`);
      where.push(
        `(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`,
      );
    }

    const whereSql = where.join(" AND ");
    const countResult = await this.prisma.pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM auth.users u WHERE ${whereSql}`,
      params,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    params.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rowsResult = await this.prisma.pool.query<UserWithScopeRow>(
      `${SELECT_USER_WITH_SCOPE}
       WHERE ${whereSql}
       ORDER BY u.full_name ASC, u.id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows: rowsResult.rows, total };
  }

  async insertUser(input: {
    email: string;
    fullName: string;
    role: UserRole;
    scopeId: string;
    phone: string;
  }): Promise<string> {
    const result = await this.prisma.pool.query<{ id: string }>(
      `INSERT INTO auth.users (email, full_name, role, scope_id, status, phone)
       VALUES ($1, $2, $3::auth.user_role, $4::uuid,
               'pending_activation'::auth.user_status, $5)
       RETURNING id`,
      [input.email, input.fullName, input.role, input.scopeId, input.phone],
    );
    return result.rows[0]!.id;
  }

  async updateUser(
    id: string,
    fields: Partial<{ fullName: string; role: UserRole; status: UserStatus; phone: string }>,
  ): Promise<void> {
    await this.prisma.client.user.update({ where: { id }, data: fields });
  }

  /** Session hygiene on disable: the account must stop refreshing immediately. */
  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** One SQL over the whole subtree — counts + direct-children in a single trip. */
  async scopeStats(scopeId: string): Promise<ScopeStatsRow> {
    const result = await this.prisma.pool.query<ScopeStatsRow>(
      `SELECT
         COUNT(u.id)::int AS total,
         COUNT(u.id) FILTER (WHERE u.status = 'active')::int AS active,
         COUNT(u.id) FILTER (WHERE u.status = 'pending_activation')::int AS pending_activation,
         COUNT(u.id) FILTER (WHERE u.status = 'disabled')::int AS disabled,
         COUNT(u.id) FILTER (WHERE u.role = 'student')::int AS students,
         COUNT(u.id) FILTER (WHERE u.role = 'teacher')::int AS teachers,
         (SELECT COUNT(*)::int FROM org.scope_hierarchy c
          WHERE c.ancestor_id = $1::uuid AND c.depth = 1) AS child_scopes
       FROM org.scope_hierarchy sh
       LEFT JOIN auth.users u ON u.scope_id = sh.descendant_id
       WHERE sh.ancestor_id = $1::uuid`,
      [scopeId],
    );
    return result.rows[0]!;
  }
}
