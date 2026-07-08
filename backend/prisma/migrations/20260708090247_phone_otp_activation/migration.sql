-- AlterTable
ALTER TABLE "auth"."users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "auth"."otp_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'activation',
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_requests_user_id_purpose_consumed_at_idx" ON "auth"."otp_requests"("user_id", "purpose", "consumed_at");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "auth"."users"("phone");

-- AddForeignKey
ALTER TABLE "auth"."otp_requests" ADD CONSTRAINT "otp_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
