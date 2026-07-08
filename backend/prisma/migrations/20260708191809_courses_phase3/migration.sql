-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "courses";

-- CreateTable
CREATE TABLE "courses"."courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "owner_scope_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."chapters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chapter_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "video_asset_key" TEXT,
    "video_size_bytes" BIGINT,
    "video_duration_label" TEXT,
    "exam_id" UUID,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses"."progress" (
    "user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "client_ts" BIGINT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_id" UUID NOT NULL,

    CONSTRAINT "progress_pkey" PRIMARY KEY ("user_id","page_id")
);

-- CreateIndex
CREATE INDEX "courses_owner_scope_id_status_idx" ON "courses"."courses"("owner_scope_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_course_id_seq_key" ON "courses"."chapters"("course_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "pages_chapter_id_seq_key" ON "courses"."pages"("chapter_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "progress_event_id_key" ON "courses"."progress"("event_id");

-- CreateIndex
CREATE INDEX "progress_user_id_course_id_idx" ON "courses"."progress"("user_id", "course_id");

-- AddForeignKey
ALTER TABLE "courses"."courses" ADD CONSTRAINT "courses_owner_scope_id_fkey" FOREIGN KEY ("owner_scope_id") REFERENCES "org"."scopes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."chapters" ADD CONSTRAINT "chapters_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."pages" ADD CONSTRAINT "pages_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "courses"."chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."progress" ADD CONSTRAINT "progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."progress" ADD CONSTRAINT "progress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"."courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses"."progress" ADD CONSTRAINT "progress_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "courses"."pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-edited hardening (Prisma doesn't model CHECK constraints) ------------

ALTER TABLE "courses"."courses"
  ADD CONSTRAINT "courses_status_check" CHECK (status IN ('draft', 'published'));

ALTER TABLE "courses"."pages"
  ADD CONSTRAINT "pages_type_check"
  CHECK (type IN ('text_content', 'video', 'assessment_embed'));

-- Shape-per-type: text pages carry markdown, video pages carry the full
-- asset triple (and only they do), assessment pages carry the embedded exam.
ALTER TABLE "courses"."pages"
  ADD CONSTRAINT "pages_text_shape_check"
  CHECK (type <> 'text_content' OR body IS NOT NULL);

ALTER TABLE "courses"."pages"
  ADD CONSTRAINT "pages_video_shape_check"
  CHECK ((type = 'video') = (video_asset_key IS NOT NULL
                             AND video_size_bytes IS NOT NULL
                             AND video_duration_label IS NOT NULL));

ALTER TABLE "courses"."pages"
  ADD CONSTRAINT "pages_assessment_shape_check"
  CHECK ((type = 'assessment_embed') = (exam_id IS NOT NULL));

-- pages.exam_id references cbt.exams but is deliberately NOT a cross-schema
-- FK (module seam) — it is validated on write (seed today, authoring later).
COMMENT ON COLUMN "courses"."pages"."exam_id" IS
  'References cbt.exams(id); validated on write, no cross-schema FK (module seam).';

COMMENT ON TABLE "courses"."progress" IS
  'LWW-Element-Set reading progress keyed (user_id, page_id); one atomic ON CONFLICT upsert per event — identical merge shape to cbt.answers (TECHSTACK §5.3).';
