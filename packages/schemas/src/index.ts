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

/* ------------------------ Role ↔ level invariant ------------------------ */

/**
 * Confirmed hierarchy refinement: every role is anchored to exactly one
 * scope level — a division_admin sits at a division scope, students and
 * teachers at a school. Enforced by the API on user create/update and on
 * every bulk-import row. (Users are single-scope in Phase I; a
 * user_scope_roles join table is the documented multi-scope migration.)
 */
export const RoleLevel: Record<UserRole, ScopeLevel> = {
  student: "school",
  teacher: "school",
  school_admin: "school",
  district_admin: "district",
  division_admin: "division",
  region_admin: "region",
  central_admin: "central",
};

export function roleAllowedAtLevel(role: UserRole, level: ScopeLevel): boolean {
  return RoleLevel[role] === level;
}

/* ------------------------------ Phone (PH) ------------------------------ */

/** Philippine mobile in E.164: +639XXXXXXXXX. */
export const PhPhoneSchema = z
  .string()
  .regex(/^\+639\d{9}$/, "Use a Philippine mobile number, e.g. 09171234567");
export type PhPhone = z.infer<typeof PhPhoneSchema>;

/** Normalizes 09…, 639…, +63 9… (spaces/dashes tolerated) to +639XXXXXXXXX; null if not a PH mobile. */
export function normalizePhPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "");
  const m =
    /^(?:\+?63|0)(9\d{9})$/.exec(digits) ?? /^(9\d{9})$/.exec(digits);
  return m ? `+63${m[1]}` : null;
}

/** Masks all but the last 4 digits: +63••••••1234. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}${"•".repeat(6)}${phone.slice(-4)}`;
}

/* --------------------------------- Users -------------------------------- */

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  scopeId: z.uuid(),
  scopeName: z.string(),
  scopeLevel: ScopeLevelSchema,
  /** Masked except for the caller's own record. */
  phoneMasked: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type User = z.infer<typeof UserSchema>;

export const ListUsersQuerySchema = z.object({
  /** Root of the search; must be the caller's scope or a descendant. Defaults to the caller's scope. */
  scopeId: z.uuid().optional(),
  /** true (default) searches the whole subtree under scopeId; false = that scope only. */
  includeDescendants: z.coerce.boolean().default(true),
  role: UserRoleSchema.optional(),
  status: UserStatusSchema.optional(),
  /** Case-insensitive match on name or email. */
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export const ListUsersResponseSchema = z.object({
  items: z.array(UserSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;

export const CreateUserRequestSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(1).max(200),
  role: UserRoleSchema,
  scopeId: z.uuid(),
  phone: PhPhoneSchema,
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  role: UserRoleSchema.optional(),
  status: UserStatusSchema.optional(),
  phone: PhPhoneSchema.optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const MeResponseSchema = z.object({
  user: UserSchema,
  /** Breadcrumb chain for the user's scope, Central first. */
  breadcrumb: z.array(ScopeWithDepthSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/* -------------------- Activation (phone OTP, Usapp-style) -------------------- */

export const ActivationRequestSchema = z.object({
  email: z.email(),
});
export type ActivationRequest = z.infer<typeof ActivationRequestSchema>;

/** The channel the activation code went out over — decides which copy to show. */
export const OtpChannelSchema = z.enum(["usapp", "sms"]);
export type OtpChannel = z.infer<typeof OtpChannelSchema>;

export const ActivationRequestResponseSchema = z.object({
  /** e.g. +63••••••1234 — never the full number. */
  maskedPhone: z.string(),
  expiresInSec: z.number().int().positive(),
  /** Where the code was delivered: the Usapp app, or an SMS. */
  channel: OtpChannelSchema,
  /**
   * Development convenience ONLY (OTP_DELIVERY_DRIVER=mock + NODE_ENV=development):
   * the code is surfaced so flows can be exercised without a real delivery
   * network. Absent in staging/production.
   */
  devCode: z.string().optional(),
});
export type ActivationRequestResponse = z.infer<typeof ActivationRequestResponseSchema>;

export const ActivationConfirmSchema = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8).max(256),
});
export type ActivationConfirm = z.infer<typeof ActivationConfirmSchema>;

/* ------------------------------ Scope stats ------------------------------ */

export const ScopeStatsResponseSchema = z.object({
  scopeId: z.uuid(),
  /** Counts across the scope's whole subtree (self included). */
  users: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    pendingActivation: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    students: z.number().int().nonnegative(),
    teachers: z.number().int().nonnegative(),
  }),
  /** Direct children of this scope. */
  childScopes: z.number().int().nonnegative(),
});
export type ScopeStatsResponse = z.infer<typeof ScopeStatsResponseSchema>;

/* ------------------------- Provisioning (async) ------------------------- */

/** Required CSV header for bulk import (order-exact). */
export const CSV_IMPORT_HEADER = ["email", "full_name", "role", "phone"] as const;

/* ----------------------- Phase II — CBT & sync ----------------------- */

export const QuestionTypes = ["mcq", "tf", "ident"] as const;
export const QuestionTypeSchema = z.enum(QuestionTypes);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

/** Envelope encryption: AES-256-GCM data key wrapped with the per-exam
 *  RSA-OAEP-256 public key. Direct RSA is capped at 190 bytes — never
 *  encrypt payloads with RSA directly (TECHSTACK §3). All fields base64. */
export const EncryptedEnvelopeSchema = z.object({
  alg: z.literal("RSA-OAEP-256+A256GCM"),
  keyVersion: z.number().int().positive(),
  wrappedKey: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});
export type EncryptedEnvelope = z.infer<typeof EncryptedEnvelopeSchema>;

export const AttemptStates = ["none", "in_progress", "submitted", "grading", "graded"] as const;
export const AttemptStateSchema = z.enum(AttemptStates);
export type AttemptState = z.infer<typeof AttemptStateSchema>;

/** Student-facing exam list entry (visibility = downward inheritance). */
export const ExamListItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  totalItems: z.number().int().positive(),
  durationMinutes: z.number().int().positive(),
  opensAt: z.iso.datetime({ offset: true }),
  closesAt: z.iso.datetime({ offset: true }),
  attemptState: AttemptStateSchema,
  attemptId: z.uuid().nullable(),
  /** e.g. "10/12" once graded. */
  score: z.string().nullable(),
  /** Approximate download size shown before download (bytes). */
  packageBytes: z.number().int().nonnegative(),
});
export type ExamListItem = z.infer<typeof ExamListItemSchema>;

/** Downloaded-for-offline package. Correct answers NEVER leave the server. */
export const ExamPackageSchema = z.object({
  examId: z.uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  durationMinutes: z.number().int().positive(),
  closesAt: z.iso.datetime({ offset: true }),
  /** Versioned per-exam RSA-OAEP-256 public key (SPKI PEM). */
  publicKeyPem: z.string().min(1),
  keyVersion: z.number().int().positive(),
  questions: z.array(
    z.object({
      id: z.uuid(),
      seq: z.number().int().positive(),
      type: QuestionTypeSchema,
      text: z.string(),
      options: z.array(z.object({ id: z.string(), text: z.string() })).nullable(),
    }),
  ),
});
export type ExamPackage = z.infer<typeof ExamPackageSchema>;

export const StartAttemptResponseSchema = z.object({
  attemptId: z.uuid(),
  examId: z.uuid(),
  startedAt: z.iso.datetime({ offset: true }),
  /** Server-anchored wall-clock deadline (started + duration, capped at closesAt). */
  deadlineAt: z.iso.datetime({ offset: true }),
});
export type StartAttemptResponse = z.infer<typeof StartAttemptResponseSchema>;

/** LWW sync events. `id` is the client-generated idempotency key (uuid).
 *  `clientTs` is advisory within the server-validated attempt window. */
export const AnswerEventSchema = z.object({
  kind: z.literal("answer"),
  id: z.uuid(),
  attemptId: z.uuid(),
  questionId: z.uuid(),
  payload: EncryptedEnvelopeSchema,
  clientTs: z.number().int().positive(),
});
export type AnswerEvent = z.infer<typeof AnswerEventSchema>;

export const SubmitEventSchema = z.object({
  kind: z.literal("submit"),
  id: z.uuid(),
  attemptId: z.uuid(),
  answeredCount: z.number().int().nonnegative(),
  clientTs: z.number().int().positive(),
});
export type SubmitEvent = z.infer<typeof SubmitEventSchema>;

/** Course reading progress — "page completed" (Phase III; same LWW pipeline). */
export const ProgressEventSchema = z.object({
  kind: z.literal("progress"),
  id: z.uuid(),
  courseId: z.uuid(),
  pageId: z.uuid(),
  clientTs: z.number().int().positive(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

export const SyncEventSchema = z.discriminatedUnion("kind", [
  AnswerEventSchema,
  SubmitEventSchema,
  ProgressEventSchema,
]);
export type SyncEvent = z.infer<typeof SyncEventSchema>;

export const SyncBatchRequestSchema = z.object({
  events: z.array(SyncEventSchema).min(1).max(100),
});
export type SyncBatchRequest = z.infer<typeof SyncBatchRequestSchema>;

export const SyncOutcomes = ["merged", "stale", "duplicate", "rejected"] as const;
export const SyncBatchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.uuid(),
      outcome: z.enum(SyncOutcomes),
      reason: z.string().optional(),
    }),
  ),
});
export type SyncBatchResponse = z.infer<typeof SyncBatchResponseSchema>;

export const AttemptStatusResponseSchema = z.object({
  attemptId: z.uuid(),
  examId: z.uuid(),
  state: AttemptStateSchema,
  answersReceived: z.number().int().nonnegative(),
  totalItems: z.number().int().positive(),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  score: z.string().nullable(),
});
export type AttemptStatusResponse = z.infer<typeof AttemptStatusResponseSchema>;

/* --------------------- Phase III — headless courses --------------------- */

export const PageTypes = ["text_content", "video", "assessment_embed"] as const;
export const PageTypeSchema = z.enum(PageTypes);
export type PageType = z.infer<typeof PageTypeSchema>;

export const CourseListItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  subject: z.string(),
  version: z.number().int().positive(),
  chapters: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  completedPages: z.number().int().nonnegative(),
  /** Approximate manifest download size shown before download (bytes). */
  manifestBytes: z.number().int().nonnegative(),
});
export type CourseListItem = z.infer<typeof CourseListItemSchema>;

/** Headless delivery: pure data, rendered by the PWA's type switch.
 *  Text bodies ship inline (markdown); video ships an authenticated asset
 *  path + size (whole-file blob download — the universal offline fallback;
 *  HLS segmenting is the documented upgrade); assessment embeds reference
 *  a published exam. */
export const CoursePageSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().positive(),
  type: PageTypeSchema,
  title: z.string(),
  body: z.string().nullable(),
  video: z
    .object({
      assetPath: z.string(),
      sizeBytes: z.number().int().positive(),
      durationLabel: z.string(),
    })
    .nullable(),
  examId: z.uuid().nullable(),
});
export type CoursePage = z.infer<typeof CoursePageSchema>;

export const CourseManifestSchema = z.object({
  courseId: z.uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  subject: z.string(),
  chapters: z.array(
    z.object({
      id: z.uuid(),
      seq: z.number().int().positive(),
      title: z.string(),
      pages: z.array(CoursePageSchema),
    }),
  ),
});
export type CourseManifest = z.infer<typeof CourseManifestSchema>;

export const CourseProgressResponseSchema = z.object({
  courseId: z.uuid(),
  completedPageIds: z.array(z.uuid()),
});
export type CourseProgressResponse = z.infer<typeof CourseProgressResponseSchema>;

/* ------------------- Phase IV — credentials & verification ------------------- */

export const CredentialKinds = ["badge", "certificate"] as const;
export const CredentialKindSchema = z.enum(CredentialKinds);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

export const CredentialStatuses = ["active", "revoked"] as const;
export const CredentialStatusSchema = z.enum(CredentialStatuses);
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;

/** Wallet entry (the holder's own view — unmasked). */
export const CredentialListItemSchema = z.object({
  id: z.uuid(),
  kind: CredentialKindSchema,
  title: z.string(),
  /** e.g. "S8" — medallion monogram. */
  monogram: z.string(),
  status: CredentialStatusSchema,
  controlNo: z.string(),
  verifyCode: z.string(),
  issuedAt: z.iso.datetime({ offset: true }),
  issuerLine: z.string(),
});
export type CredentialListItem = z.infer<typeof CredentialListItemSchema>;

export const CredentialDetailSchema = CredentialListItemSchema.extend({
  holderName: z.string(),
  /** Public verification URL (QR payload). */
  verifyUrl: z.string(),
  /** The signed Open Badges 3.0 verifiable credential (Ed25519 Data
   *  Integrity proof; metadata_snapshot semantics — survives source deletion). */
  vc: z.record(z.string(), z.unknown()),
});
export type CredentialDetail = z.infer<typeof CredentialDetailSchema>;

/** Public verify outcome — never exposes email/phone/ID; name is masked. */
export const VerifyStatuses = ["verified", "revoked", "not_found"] as const;
export const VerifyResponseSchema = z.object({
  status: z.enum(VerifyStatuses),
  /** Present for verified/revoked. */
  maskedName: z.string().nullable(),
  title: z.string().nullable(),
  issuerLine: z.string().nullable(),
  issuedAt: z.iso.datetime({ offset: true }).nullable(),
  controlNo: z.string().nullable(),
  /** Signature check result (verified at read time with the issuer key). */
  signatureValid: z.boolean().nullable(),
});
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

/** Masks all but the first letter of each name word: "Ana D. Reyes" → "A** D. R****". */
export function maskName(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .map((w) =>
      /^[A-Za-z]\.?$/.test(w) || w.length <= 2
        ? w
        : `${w[0]}${"*".repeat(Math.min(w.length - 1, 5))}`,
    )
    .join(" ");
}

export const RevokeCredentialRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RevokeCredentialRequest = z.infer<typeof RevokeCredentialRequestSchema>;

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
