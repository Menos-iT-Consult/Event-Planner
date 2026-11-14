BEGIN;

DO $$ BEGIN
  CREATE TYPE "PasswordResetPurpose" AS ENUM ('PASSWORD_RESET', 'ADMIN_INVITE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PasswordResetToken"
  ADD COLUMN IF NOT EXISTS "purpose" "PasswordResetPurpose" NOT NULL DEFAULT 'PASSWORD_RESET';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disabledReason" TEXT;

ALTER TABLE "TicketOrder"
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
UPDATE "TicketOrder"
SET "paidAt" = "updatedAt"
WHERE "status" = 'PAID' AND "paidAt" IS NULL;
CREATE INDEX IF NOT EXISTS "TicketOrder_status_paidAt_idx"
  ON "TicketOrder"("status", "paidAt");

ALTER TABLE "VotePurchase"
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
UPDATE "VotePurchase"
SET "paidAt" = "updatedAt"
WHERE "status" = 'PAID' AND "paidAt" IS NULL;
CREATE INDEX IF NOT EXISTS "VotePurchase_status_paidAt_idx"
  ON "VotePurchase"("status", "paidAt");

COMMIT;
