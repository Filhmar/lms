-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "auth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "org";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "prov";

-- CreateEnum
CREATE TYPE "org"."scope_level" AS ENUM ('central', 'region', 'division', 'district', 'school');

-- CreateEnum
CREATE TYPE "auth"."user_role" AS ENUM ('student', 'teacher', 'school_admin', 'district_admin', 'division_admin', 'region_admin', 'central_admin');

-- CreateEnum
CREATE TYPE "auth"."user_status" AS ENUM ('pending_activation', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "prov"."job_status" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "org"."scopes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "level" "org"."scope_level" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org"."scope_hierarchy" (
    "ancestor_id" UUID NOT NULL,
    "descendant_id" UUID NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "scope_hierarchy_pkey" PRIMARY KEY ("ancestor_id","descendant_id")
);

-- CreateTable
CREATE TABLE "auth"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "auth"."user_role" NOT NULL,
    "scope_id" UUID NOT NULL,
    "status" "auth"."user_status" NOT NULL DEFAULT 'pending_activation',
    "password_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prov"."jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL DEFAULT 'bulk_import',
    "status" "prov"."job_status" NOT NULL DEFAULT 'queued',
    "target_scope_id" UUID NOT NULL,
    "file_path" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "success" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scope_hierarchy_descendant_id_ancestor_id_idx" ON "org"."scope_hierarchy"("descendant_id", "ancestor_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "auth"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "auth"."refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "auth"."refresh_tokens"("user_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "org"."scope_hierarchy" ADD CONSTRAINT "scope_hierarchy_ancestor_id_fkey" FOREIGN KEY ("ancestor_id") REFERENCES "org"."scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org"."scope_hierarchy" ADD CONSTRAINT "scope_hierarchy_descendant_id_fkey" FOREIGN KEY ("descendant_id") REFERENCES "org"."scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "org"."scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
