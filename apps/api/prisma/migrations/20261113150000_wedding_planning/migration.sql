ALTER TYPE "MessageAudience" ADD VALUE IF NOT EXISTS 'PENDING';

BEGIN;

DO $$ BEGIN
  CREATE TYPE "VendorStatus" AS ENUM (
    'SHORTLISTED',
    'CONTACTED',
    'QUOTED',
    'BOOKED',
    'COMPLETED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "GuestHousehold" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuestHousehold_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GuestHousehold_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "GuestHousehold_eventId_name_idx" ON "GuestHousehold"("eventId", "name");

CREATE TABLE IF NOT EXISTS "WeddingProfile" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "headline" TEXT,
  "welcomeMessage" TEXT,
  "story" TEXT,
  "dressCode" TEXT,
  "travelInfo" TEXT,
  "faq" JSONB,
  "invitationMessage" TEXT,
  "showStory" BOOLEAN NOT NULL DEFAULT true,
  "showDressCode" BOOLEAN NOT NULL DEFAULT true,
  "showTravelInfo" BOOLEAN NOT NULL DEFAULT true,
  "showSchedule" BOOLEAN NOT NULL DEFAULT true,
  "showRegistry" BOOLEAN NOT NULL DEFAULT true,
  "rsvpEnabled" BOOLEAN NOT NULL DEFAULT true,
  "showRsvpDeadline" BOOLEAN NOT NULL DEFAULT true,
  "rsvpDeadline" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WeddingProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WeddingProfile_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WeddingProfile_eventId_key" ON "WeddingProfile"("eventId");

CREATE TABLE IF NOT EXISTS "WeddingDay" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "location" TEXT,
  "notes" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WeddingDay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WeddingDay_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WeddingDay_eventId_name_key" ON "WeddingDay"("eventId", "name");
CREATE INDEX IF NOT EXISTS "WeddingDay_eventId_date_sortOrder_idx" ON "WeddingDay"("eventId", "date", "sortOrder");

ALTER TABLE "Guest"
  ADD COLUMN IF NOT EXISTS "householdId" TEXT,
  ADD COLUMN IF NOT EXISTS "invitationSentAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Guest_householdId_idx" ON "Guest"("householdId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Guest_householdId_fkey' AND conrelid = '"Guest"'::regclass) THEN
    ALTER TABLE "Guest"
      ADD CONSTRAINT "Guest_householdId_fkey"
      FOREIGN KEY ("householdId") REFERENCES "GuestHousehold"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "RegistryItem"
  ADD COLUMN IF NOT EXISTS "category" TEXT,
  ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "claimedCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "RegistryGiftClaim" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegistryGiftClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RegistryGiftClaim_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "RegistryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RegistryGiftClaim_itemId_createdAt_idx" ON "RegistryGiftClaim"("itemId", "createdAt");

ALTER TABLE "EventSession" ADD COLUMN IF NOT EXISTS "weddingDayId" TEXT;
CREATE INDEX IF NOT EXISTS "EventSession_weddingDayId_idx" ON "EventSession"("weddingDayId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventSession_weddingDayId_fkey' AND conrelid = '"EventSession"'::regclass) THEN
    ALTER TABLE "EventSession"
      ADD CONSTRAINT "EventSession_weddingDayId_fkey"
      FOREIGN KEY ("weddingDayId") REFERENCES "WeddingDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "BudgetItem"
  ADD COLUMN IF NOT EXISTS "vendorId" TEXT,
  ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "BudgetItem_eventId_dueAt_idx" ON "BudgetItem"("eventId", "dueAt");
CREATE INDEX IF NOT EXISTS "BudgetItem_vendorId_idx" ON "BudgetItem"("vendorId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetItem_vendorId_fkey' AND conrelid = '"BudgetItem"'::regclass) THEN
    ALTER TABLE "BudgetItem"
      ADD CONSTRAINT "BudgetItem_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Vendor"
  ADD COLUMN IF NOT EXISTS "status" "VendorStatus" NOT NULL DEFAULT 'SHORTLISTED',
  ADD COLUMN IF NOT EXISTS "quotedCost" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "paymentDueAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Vendor_eventId_status_idx" ON "Vendor"("eventId", "status");

CREATE TABLE IF NOT EXISTS "EventTask" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'GENERAL',
  "templateKey" TEXT,
  "assigneeId" TEXT,
  "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "dependsOn" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventTask_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "EventTask"
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS "templateKey" TEXT;
CREATE INDEX IF NOT EXISTS "EventTask_eventId_status_idx" ON "EventTask"("eventId", "status");
CREATE INDEX IF NOT EXISTS "EventTask_eventId_dueAt_idx" ON "EventTask"("eventId", "dueAt");
CREATE UNIQUE INDEX IF NOT EXISTS "EventTask_eventId_templateKey_key" ON "EventTask"("eventId", "templateKey");

CREATE TABLE IF NOT EXISTS "SeatingPlan" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeatingPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeatingPlan_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SeatingPlan_eventId_name_key" ON "SeatingPlan"("eventId", "name");
CREATE INDEX IF NOT EXISTS "SeatingPlan_eventId_idx" ON "SeatingPlan"("eventId");
ALTER TABLE "SeatingPlan" ADD COLUMN IF NOT EXISTS "weddingDayId" TEXT;
CREATE INDEX IF NOT EXISTS "SeatingPlan_weddingDayId_idx" ON "SeatingPlan"("weddingDayId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SeatingPlan_weddingDayId_fkey' AND conrelid = '"SeatingPlan"'::regclass) THEN
    ALTER TABLE "SeatingPlan"
      ADD CONSTRAINT "SeatingPlan_weddingDayId_fkey"
      FOREIGN KEY ("weddingDayId") REFERENCES "WeddingDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
