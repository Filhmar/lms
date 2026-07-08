-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "cbt";

-- CreateTable
CREATE TABLE "cbt"."exams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "owner_scope_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "duration_minutes" INTEGER NOT NULL,
    "opens_at" TIMESTAMPTZ(6) NOT NULL,
    "closes_at" TIMESTAMPTZ(6) NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "public_key_pem" TEXT NOT NULL,
    "private_key_pem" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cbt"."questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exam_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "options" JSONB,
    "correct" JSONB NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cbt"."attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exam_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "answered_count_claimed" INTEGER,
    "score_raw" INTEGER,
    "score_total" INTEGER,
    "graded_at" TIMESTAMPTZ(6),

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cbt"."answers" (
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "envelope" JSONB NOT NULL,
    "client_ts" BIGINT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_id" UUID NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("attempt_id","question_id")
);

-- CreateTable
CREATE TABLE "cbt"."sync_events" (
    "event_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "attempt_id" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "exams_owner_scope_id_status_idx" ON "cbt"."exams"("owner_scope_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "questions_exam_id_seq_key" ON "cbt"."questions"("exam_id", "seq");

-- CreateIndex
CREATE INDEX "attempts_user_id_idx" ON "cbt"."attempts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_exam_id_user_id_key" ON "cbt"."attempts"("exam_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_event_id_key" ON "cbt"."answers"("event_id");

-- CreateIndex
CREATE INDEX "sync_events_attempt_id_idx" ON "cbt"."sync_events"("attempt_id");

-- AddForeignKey
ALTER TABLE "cbt"."exams" ADD CONSTRAINT "exams_owner_scope_id_fkey" FOREIGN KEY ("owner_scope_id") REFERENCES "org"."scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt"."questions" ADD CONSTRAINT "questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "cbt"."exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt"."attempts" ADD CONSTRAINT "attempts_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "cbt"."exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt"."attempts" ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt"."answers" ADD CONSTRAINT "answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "cbt"."attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cbt"."answers" ADD CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "cbt"."questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-edited hardening (Prisma doesn't model CHECK constraints) ------------

ALTER TABLE "cbt"."exams"
  ADD CONSTRAINT "exams_status_check" CHECK (status IN ('draft', 'published'));

ALTER TABLE "cbt"."questions"
  ADD CONSTRAINT "questions_type_check" CHECK (type IN ('mcq', 'tf', 'ident'));

ALTER TABLE "cbt"."attempts"
  ADD CONSTRAINT "attempts_state_check"
  CHECK (state IN ('in_progress', 'submitted', 'grading', 'graded'));

-- ⚠️ DEV-GRADE KEY CUSTODY: the per-exam RSA private key is stored in
-- plaintext. Production custody is a KMS behind the KeyProvider port.
COMMENT ON COLUMN "cbt"."exams"."private_key_pem" IS
  'DEV-GRADE custody: plaintext RSA private key. Replace the ''db'' KeyProvider driver with a KMS before production. Never expose via API or logs.';

-- Partitioning cbt.answers by exam window (then archiving graded partitions
-- to object storage) is the documented scale valve — deliberately DEFERRED.
COMMENT ON TABLE "cbt"."answers" IS
  'LWW-Element-Set answer state; one atomic ON CONFLICT upsert per event. Partition by exam window when national-scale load demands it (TECHSTACK §5.3).';
