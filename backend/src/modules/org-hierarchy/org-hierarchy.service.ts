import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BreadcrumbResponse,
  CreateScopeRequest,
  Scope,
  ScopeLevel,
  SubtreeResponse,
} from "@rl/schemas";
import { ScopeLevels } from "@rl/schemas";
import type { AuthenticatedUser } from "../auth";
import { OrgHierarchyRepository, type ScopeRow } from "./org-hierarchy.repository";
import { ScopeAccessService } from "./scope-access.service";

const levelIndex = (level: ScopeLevel): number => ScopeLevels.indexOf(level);

@Injectable()
export class OrgHierarchyService {
  constructor(
    private readonly repo: OrgHierarchyRepository,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  async createScope(input: CreateScopeRequest, actor: AuthenticatedUser): Promise<Scope> {
    if (input.level === "central") {
      if (input.parentId) {
        throw new BadRequestException("A central scope cannot have a parent");
      }
      if (actor.role !== "central_admin") {
        throw new ForbiddenException("Only central_admin can create a central scope");
      }
    } else {
      if (!input.parentId) {
        throw new BadRequestException(`A ${input.level} scope requires parentId`);
      }
      const parent = await this.repo.findScopeById(input.parentId);
      if (!parent) throw new NotFoundException("Parent scope not found");

      // Level ordering: child must be EXACTLY one level below its parent.
      if (levelIndex(input.level) !== levelIndex(parent.level as ScopeLevel) + 1) {
        throw new BadRequestException(
          `Invalid level ordering: a ${parent.level} scope can only contain ` +
            `${ScopeLevels[levelIndex(parent.level as ScopeLevel) + 1] ?? "nothing"} scopes`,
        );
      }

      // The actor must sit at or above the parent (downward inheritance).
      const allowed = await this.scopeAccess.canAccess(actor.scopeId, input.parentId);
      if (!allowed) {
        throw new ForbiddenException("Parent scope is outside your hierarchy");
      }
    }

    const { id, createdAt } = await this.repo.insertScope({
      name: input.name,
      level: input.level,
      parentId: input.parentId ?? null,
    });
    await this.scopeAccess.bumpVersion();

    return {
      id,
      name: input.name,
      level: input.level,
      createdAt: createdAt.toISOString(),
    };
  }

  async getSubtree(scopeId: string, actor: AuthenticatedUser): Promise<SubtreeResponse> {
    await this.assertVisible(scopeId, actor);
    const rows = await this.repo.getSubtree(scopeId);
    if (rows.length === 0) throw new NotFoundException("Scope not found");
    return { rootId: scopeId, scopes: rows.map(toScopeWithDepth) };
  }

  async getBreadcrumb(
    scopeId: string,
    actor: AuthenticatedUser,
  ): Promise<BreadcrumbResponse> {
    await this.assertVisible(scopeId, actor);
    const rows = await this.repo.getBreadcrumb(scopeId);
    if (rows.length === 0) throw new NotFoundException("Scope not found");
    return { scopeId, chain: rows.map(toScopeWithDepth) };
  }

  /**
   * Lateral/upward isolation: the requester's own scope must be an
   * ancestor-or-self of the target. A school user asking about its Division
   * (or a sibling school) gets 403 — before any existence information leaks.
   */
  private async assertVisible(scopeId: string, actor: AuthenticatedUser): Promise<void> {
    const allowed = await this.scopeAccess.canAccess(actor.scopeId, scopeId);
    if (!allowed) {
      throw new ForbiddenException(
        "Scope not accessible from your position in the hierarchy",
      );
    }
  }
}

function toScopeWithDepth(row: ScopeRow) {
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    createdAt: row.created_at.toISOString(),
    depth: row.depth,
  };
}
