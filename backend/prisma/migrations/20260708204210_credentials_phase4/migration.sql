-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "creds";

-- CreateTable
CREATE TABLE "creds"."issuer_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "public_key_pem" TEXT NOT NULL,
    "private_key_pem" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issuer_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creds"."credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "monogram" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "verify_code" TEXT NOT NULL,
    "exam_id" UUID,
    "course_id" UUID,
    "issued_scope_id" UUID NOT NULL,
    "issuer_line" TEXT NOT NULL,
    "metadata_snapshot" JSONB NOT NULL,
    "vc" JSONB NOT NULL,
    "assertion_hash" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "revoked_reason" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creds"."verify_read" (
    "verify_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "masked_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuer_line" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "control_no" TEXT NOT NULL,
    "assertion_hash" TEXT NOT NULL,
    "vc" JSONB NOT NULL,
    "key_version" INTEGER NOT NULL,

    CONSTRAINT "verify_read_pkey" PRIMARY KEY ("verify_code")
);

-- CreateTable
CREATE TABLE "creds"."audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "credential_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "issuer_keys_version_key" ON "creds"."issuer_keys"("version");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_control_no_key" ON "creds"."credentials"("control_no");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_verify_code_key" ON "creds"."credentials"("verify_code");

-- CreateIndex
CREATE INDEX "credentials_user_id_idx" ON "creds"."credentials"("user_id");

-- CreateIndex
CREATE INDEX "credentials_issued_scope_id_issued_at_idx" ON "creds"."credentials"("issued_scope_id", "issued_at");

-- CreateIndex
CREATE INDEX "audit_credential_id_at_idx" ON "creds"."audit"("credential_id", "at");

-- Hand-edited hardening (Prisma doesn't model CHECK constraints, partial
-- indexes, or sequences) --------------------------------------------------

ALTER TABLE "creds"."credentials"
  ADD CONSTRAINT "credentials_kind_check" CHECK (kind IN ('badge', 'certificate'));

ALTER TABLE "creds"."credentials"
  ADD CONSTRAINT "credentials_status_check" CHECK (status IN ('active', 'revoked'));

-- A revoked credential must carry its reason/timestamp; an active one must not.
ALTER TABLE "creds"."credentials"
  ADD CONSTRAINT "credentials_revoked_shape_check"
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL));

ALTER TABLE "creds"."verify_read"
  ADD CONSTRAINT "verify_read_status_check" CHECK (status IN ('active', 'revoked'));

ALTER TABLE "creds"."audit"
  ADD CONSTRAINT "audit_action_check" CHECK (action IN ('issued', 'revoked', 'restored'));

-- Idempotent automatic issuance: at most ONE credential per (user, exam) and
-- per (user, course). Partial unique indexes (NULL sources excluded) — the
-- issuance INSERT uses ON CONFLICT ... WHERE ... DO NOTHING against these,
-- so a same-instant race (double grading, concurrent progress batches)
-- yields exactly one row.
CREATE UNIQUE INDEX "credentials_user_id_exam_id_key"
  ON "creds"."credentials"("user_id", "exam_id") WHERE "exam_id" IS NOT NULL;

CREATE UNIQUE INDEX "credentials_user_id_course_id_key"
  ON "creds"."credentials"("user_id", "course_id") WHERE "course_id" IS NOT NULL;

-- Control-number registry: control_no = YYYY-MM-NNNNNN with NNNNNN from this
-- sequence. Starts above the fixed demo credential (2026-04-118203) so
-- seeded and generated numbers never collide.
CREATE SEQUENCE "creds"."control_no_seq" AS bigint START WITH 118204;

-- creds.credentials.exam_id / course_id reference cbt.exams / courses.courses
-- but are deliberately NOT cross-schema FKs (module seam) — the credential
-- must survive source deletion (metadata_snapshot carries the proof).
COMMENT ON COLUMN "creds"."credentials"."exam_id" IS
  'References cbt.exams(id); no cross-schema FK (module seam) — snapshot survives deletion.';
COMMENT ON COLUMN "creds"."credentials"."course_id" IS
  'References courses.courses(id); no cross-schema FK (module seam) — snapshot survives deletion.';

COMMENT ON TABLE "creds"."verify_read" IS
  'Denormalized read model for the standalone verify service — the ONLY table it reads besides issuer_keys; no joins against users/courses; written transactionally with creds.credentials.';
