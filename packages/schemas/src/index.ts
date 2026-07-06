/**
 * @rl/schemas — shared Zod v4 schemas + inferred types for Resilient-Learn.
 *
 * Source-only package (no build step). It is consumed:
 *  - by the frontend bundler (Next.js transpiles workspace TS), and
 *  - by the backend at runtime via Node 22 type stripping (pnpm symlinks
 *    resolve outside node_modules, so `require('@rl/schemas')` works).
 *
 * IMPORTANT: keep the syntax ERASABLE (enforced by `erasableSyntaxOnly` in
 * tsconfig): no TS `enum`, no namespaces, no parameter properties. Use
 * `as const` arrays + `z.enum(...)` instead.
 */
import { z } from "zod";

/* ----------------------------- Enumerations ----------------------------- */

/** Five-level DepEd hierarchy: Central → Region → Division → District → School. */
export const ScopeLevels = [
  "central",
  "region",
  "division",
  "district",
  "school",
] as const;
export const ScopeLevelSchema = z.enum(ScopeLevels);
export type ScopeLevel = z.infer<typeof ScopeLevelSchema>;

export const UserRoles = [
  "student",
  "teacher",
  "school_admin",
  "district_admin",
  "division_admin",
  "region_admin",
  "central_admin",
] as const;
export const UserRoleSchema = z.enum(UserRoles);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const AdminRoles = [
  "school_admin",
  "district_admin",
  "division_admin",
  "region_admin",
  "central_admin",
] as const;

export const UserStatuses = ["pending_activation", "active", "disabled"] as const;
export const UserStatusSchema = z.enum(UserStatuses);
export type UserStatus = z.infer<typeof UserStatusSchema>;

/* --------------------------------- Auth --------------------------------- */

export const LoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const TokenPairSchema = z.object({
  /** RS256 JWT, 15 minutes. */
  accessToken: z.string().min(1),
  /** Opaque random 256-bit token, 7 days, stored server-side only as a SHA-256 hash. */
  refreshToken: z.string().min(1),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const LoginResponseSchema = TokenPairSchema.extend({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    fullName: z.string(),
    role: UserRoleSchema,
    scopeId: z.uuid(),
  }),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = RefreshRequestSchema;
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

/** Claims carried by the access token. Stateless — the server stores no session. */
export const JwtClaimsSchema = z.object({
  sub: z.uuid(),
  role: UserRoleSchema,
  scopeId: z.uuid(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

/* ------------------------------- Hierarchy ------------------------------ */

export const ScopeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  level: ScopeLevelSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type Scope = z.infer<typeof ScopeSchema>;

export const CreateScopeRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  level: ScopeLevelSchema,
  /** Required for every level except `central`. Must be exactly one level above. */
  parentId: z.uuid().optional(),
});
export type CreateScopeRequest = z.infer<typeof CreateScopeRequestSchema>;

/** A scope annotated with its closure-table depth relative to the query root. */
export const ScopeWithDepthSchema = ScopeSchema.extend({
  depth: z.number().int().nonnegative(),
});
export type ScopeWithDepth = z.infer<typeof ScopeWithDepthSchema>;

export const SubtreeResponseSchema = z.object({
  rootId: z.uuid(),
  /** The root itself (depth 0) plus every descendant, ordered by depth. */
  scopes: z.array(ScopeWithDepthSchema),
});
export type SubtreeResponse = z.infer<typeof SubtreeResponseSchema>;

export const BreadcrumbResponseSchema = z.object({
  scopeId: z.uuid(),
  /** Ancestors ordered by depth desc (Central first) down to the scope itself (depth 0). */
  chain: z.array(ScopeWithDepthSchema),
});
export type BreadcrumbResponse = z.infer<typeof BreadcrumbResponseSchema>;

/* ------------------------- Provisioning (async) ------------------------- */

export const JobStatuses = ["queued", "processing", "completed", "failed"] as const;
export const JobStatusSchema = z.enum(JobStatuses);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** 202 Accepted body for POST /api/v1/provisioning/bulk-import. */
export const BulkImportAcceptedSchema = z.object({
  jobId: z.uuid(),
  status: z.literal("queued"),
  message: z.string(),
  links: z.object({
    status: z.string(),
  }),
});
export type BulkImportAccepted = z.infer<typeof BulkImportAcceptedSchema>;

export const ProvisioningRowErrorSchema = z.object({
  /** 1-based data row number (header row excluded). */
  row: z.number().int().positive(),
  reason: z.string(),
});
export type ProvisioningRowError = z.infer<typeof ProvisioningRowErrorSchema>;

export const ProvisioningJobStatusSchema = z.object({
  jobId: z.uuid(),
  status: JobStatusSchema,
  progress: z.object({
    total: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  errors: z.array(ProvisioningRowErrorSchema),
});
export type ProvisioningJobStatus = z.infer<typeof ProvisioningJobStatusSchema>;
