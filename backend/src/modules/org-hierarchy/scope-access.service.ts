import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../platform/redis.service";
import { OrgHierarchyRepository } from "./org-hierarchy.repository";

const VERSION_KEY = "org:scope_hierarchy:version";
const CACHE_TTL_SEC = 3600;

/**
 * Scope authorization (TECHSTACK §5.5): resolves a caller's descendant set
 * via the closure table, Redis-cached under a scope-version key. Any
 * hierarchy mutation bumps the version, instantly invalidating every cached
 * set without enumerating keys. Downward inheritance + lateral isolation.
 */
@Injectable()
export class ScopeAccessService {
  private readonly logger = new Logger(ScopeAccessService.name);

  constructor(
    private readonly repo: OrgHierarchyRepository,
    private readonly redis: RedisService,
  ) {}

  /** Caller (at `callerScopeId`) may access `targetScopeId` iff caller is ancestor-or-self. */
  async canAccess(callerScopeId: string, targetScopeId: string): Promise<boolean> {
    if (callerScopeId === targetScopeId) return true;
    const descendants = await this.getDescendantSet(callerScopeId);
    return descendants.has(targetScopeId);
  }

  /** Redis-cached descendant set (includes the scope itself). */
  async getDescendantSet(scopeId: string): Promise<Set<string>> {
    const key = await this.cacheKey(scopeId);
    if (key) {
      try {
        const cached = await this.redis.client.smembers(key);
        if (cached.length > 0) return new Set(cached);
      } catch (err) {
        this.logger.warn(`scope cache read failed: ${String(err)}`);
      }
    }

    const ids = await this.repo.getDescendantIds(scopeId);
    if (key && ids.length > 0) {
      try {
        const pipeline = this.redis.client.pipeline();
        pipeline.sadd(key, ...ids);
        pipeline.expire(key, CACHE_TTL_SEC);
        await pipeline.exec();
      } catch (err) {
        this.logger.warn(`scope cache write failed: ${String(err)}`);
      }
    }
    return new Set(ids);
  }

  /** Bump on every hierarchy mutation — all cached sets become stale keys. */
  async bumpVersion(): Promise<void> {
    try {
      await this.redis.client.incr(VERSION_KEY);
    } catch (err) {
      // Cache-only failure: correctness falls back to the closure table.
      this.logger.warn(`scope version bump failed: ${String(err)}`);
    }
  }

  private async cacheKey(scopeId: string): Promise<string | null> {
    try {
      const version = (await this.redis.client.get(VERSION_KEY)) ?? "0";
      return `org:desc:${scopeId}:v${version}`;
    } catch {
      return null; // Redis down → skip caching, hit the closure table.
    }
  }
}
