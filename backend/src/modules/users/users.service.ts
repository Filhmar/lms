import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  RoleLevel,
  maskPhone,
  roleAllowedAtLevel,
} from "@rl/schemas";
import type {
  CreateUserRequest,
  ListUsersQuery,
  ListUsersResponse,
  MeResponse,
  ScopeStatsResponse,
  UpdateUserRequest,
  User,
  UserRole,
  UserStatus,
} from "@rl/schemas";
import type { AuthenticatedUser } from "../auth";
import { OrgHierarchyService, ScopeAccessService } from "../org-hierarchy";
import { UsersRepository, type UserWithScopeRow } from "./users.repository";

const OUTSIDE_HIERARCHY = "Scope not accessible from your position in the hierarchy";

/** Legal status moves. Activation to `active` happens ONLY via the OTP flow. */
const ALLOWED_TRANSITIONS: Record<UserStatus, UserStatus[]> = {
  pending_activation: ["disabled"],
  active: ["disabled"],
  disabled: ["active"],
};

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly scopeAccess: ScopeAccessService,
    private readonly orgHierarchy: OrgHierarchyService,
  ) {}

  /** The caller's own record + breadcrumb (any role). */
  async me(actor: AuthenticatedUser): Promise<MeResponse> {
    const row = await this.repo.findById(actor.sub);
    if (!row) throw new NotFoundException("Account not found");
    const breadcrumb = await this.orgHierarchy.getBreadcrumb(row.scope_id, actor);
    return { user: toUser(row), breadcrumb: breadcrumb.chain };
  }

  /** Admin listing rooted at the caller's scope (or a descendant of it). */
  async list(query: ListUsersQuery, actor: AuthenticatedUser): Promise<ListUsersResponse> {
    const scopeId = query.scopeId ?? actor.scopeId;
    await this.assertInSubtree(actor, scopeId);

    const { rows, total } = await this.repo.list({ ...query, scopeId });
    return {
      items: rows.map(toUser),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(input: CreateUserRequest, actor: AuthenticatedUser): Promise<User> {
    // Also rejects nonexistent scopes — they are in nobody's descendant set.
    await this.assertInSubtree(actor, input.scopeId);

    const scope = await this.repo.findScope(input.scopeId);
    if (!scope) throw new NotFoundException("Scope not found");
    if (!roleAllowedAtLevel(input.role, scope.level)) {
      throw new BadRequestException(
        `A ${input.role} belongs at a ${RoleLevel[input.role]} — this scope is a ${scope.level}`,
      );
    }

    const email = input.email.toLowerCase();
    if (await this.repo.findByEmail(email)) {
      throw new ConflictException("An account with this email already exists");
    }

    let id: string;
    try {
      id = await this.repo.insertUser({
        email,
        fullName: input.fullName,
        role: input.role,
        scopeId: input.scopeId,
        phone: input.phone,
      });
    } catch (err) {
      // Unique-violation race between the pre-check and the insert.
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictException("An account with this email already exists");
      }
      throw err;
    }

    const row = await this.repo.findById(id);
    return toUser(row!);
  }

  async update(
    id: string,
    input: UpdateUserRequest,
    actor: AuthenticatedUser,
  ): Promise<User> {
    if (id === actor.sub) {
      throw new BadRequestException(
        "You can't change your own account from here — ask another admin",
      );
    }

    const target = await this.repo.findById(id);
    if (!target) throw new NotFoundException("User not found");
    await this.assertInSubtree(actor, target.scope_id);

    // Role changes revalidate the role↔level invariant at the user's scope.
    if (input.role && !roleAllowedAtLevel(input.role, target.scope_level)) {
      throw new BadRequestException(
        `A ${input.role} belongs at a ${RoleLevel[input.role]} — ` +
          `this user's scope is a ${target.scope_level}`,
      );
    }

    if (input.status && input.status !== target.status) {
      if (!ALLOWED_TRANSITIONS[target.status].includes(input.status)) {
        throw new BadRequestException(
          target.status === "pending_activation" && input.status === "active"
            ? "This account activates by SMS code — ask the owner to use Activate account"
            : `Can't move this account from ${target.status} to ${input.status}`,
        );
      }
    }

    const fields: Partial<{
      fullName: string;
      role: UserRole;
      status: UserStatus;
      phone: string;
    }> = {};
    if (input.fullName !== undefined) fields.fullName = input.fullName;
    if (input.role !== undefined) fields.role = input.role;
    if (input.status !== undefined) fields.status = input.status;
    if (input.phone !== undefined) fields.phone = input.phone;
    if (Object.keys(fields).length > 0) {
      await this.repo.updateUser(id, fields);
    }

    // Disabling must cut the session lifeline (refresh tokens) immediately.
    if (input.status === "disabled" && target.status !== "disabled") {
      await this.repo.revokeUserRefreshTokens(id);
    }

    const updated = await this.repo.findById(id);
    return toUser(updated!);
  }

  /** Subtree user counts for a scope (access enforced by ScopeGuard upstream). */
  async scopeStats(scopeId: string): Promise<ScopeStatsResponse> {
    const scope = await this.repo.findScope(scopeId);
    if (!scope) throw new NotFoundException("Scope not found");
    const stats = await this.repo.scopeStats(scopeId);
    return {
      scopeId,
      users: {
        total: stats.total,
        active: stats.active,
        pendingActivation: stats.pending_activation,
        disabled: stats.disabled,
        students: stats.students,
        teachers: stats.teachers,
      },
      childScopes: stats.child_scopes,
    };
  }

  /** Lateral isolation: 403 before any existence detail leaks. */
  private async assertInSubtree(
    actor: AuthenticatedUser,
    targetScopeId: string,
  ): Promise<void> {
    const allowed = await this.scopeAccess.canAccess(actor.scopeId, targetScopeId);
    if (!allowed) throw new ForbiddenException(OUTSIDE_HIERARCHY);
  }
}

function toUser(row: UserWithScopeRow): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    scopeId: row.scope_id,
    scopeName: row.scope_name,
    scopeLevel: row.scope_level,
    phoneMasked: row.phone ? maskPhone(row.phone) : null,
    createdAt: row.created_at.toISOString(),
  };
}
