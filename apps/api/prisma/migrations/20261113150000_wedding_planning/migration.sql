CREATE TYPE "VendorStatus" AS ENUM (
  'SHORTLISTED',
  'CONTACTED',
  'QUOTED',
  'BOOKED',
  'COMPLETED',
  'CANCELLED'
);

ALTER TYPE "MessageAudience" ADD VALUE 'PENDING';

CREATE TABLE "GuestHousehold" (
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
CREATE INDEX "GuestHousehold_eventId_name_idx" ON "GuestHousehold"("eventId", "name");

CREATE TABLE "WeddingProfile" (
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
CREATE UNIQUE INDEX "WeddingProfile_eventId_key" ON "WeddingProfile"("eventId");

CREATE TABLE "WeddingDay" (
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
CREATE UNIQUE INDEX "WeddingDay_eventId_name_key" ON "WeddingDay"("eventId", "name");
CREATE INDEX "WeddingDay_eventId_date_sortOrder_idx" ON "WeddingDay"("eventId", "date", "sortOrder");

ALTER TABLE "Guest"
  ADD COLUMN "householdId" TEXT,
  ADD COLUMN "invitationSentAt" TIMESTAMP(3);
CREATE INDEX "Guest_householdId_idx" ON "Guest"("householdId");
ALTER TABLE "Guest"
  ADD CONSTRAINT "Guest_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "GuestHousehold"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RegistryItem"
  ADD COLUMN "category" TEXT,
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "claimedCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "RegistryGiftClaim" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegistryGiftClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RegistryGiftClaim_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "RegistryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RegistryGiftClaim_itemId_createdAt_idx" ON "RegistryGiftClaim"("itemId", "createdAt");

ALTER TABLE "EventSession" ADD COLUMN "weddingDayId" TEXT;
CREATE INDEX "EventSession_weddingDayId_idx" ON "EventSession"("weddingDayId");
ALTER TABLE "EventSession"
  ADD CONSTRAINT "EventSession_weddingDayId_fkey"
  FOREIGN KEY ("weddingDayId") REFERENCES "WeddingDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BudgetItem"
  ADD COLUMN "vendorId" TEXT,
  ADD COLUMN "dueAt" TIMESTAMP(3);
CREATE INDEX "BudgetItem_eventId_dueAt_idx" ON "BudgetItem"("eventId", "dueAt");
CREATE INDEX "BudgetItem_vendorId_idx" ON "BudgetItem"("vendorId");
ALTER TABLE "BudgetItem"
  ADD CONSTRAINT "BudgetItem_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Vendor"
  ADD COLUMN "status" "VendorStatus" NOT NULL DEFAULT 'SHORTLISTED',
  ADD COLUMN "quotedCost" DECIMAL(12,2),
  ADD COLUMN "paidAmount" DECIMAL(12,2),
  ADD COLUMN "paymentDueAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Vendor_eventId_status_idx" ON "Vendor"("eventId", "status");

ALTER TABLE "EventTask"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "templateKey" TEXT;
CREATE UNIQUE INDEX "EventTask_eventId_templateKey_key" ON "EventTask"("eventId", "templateKey");

ALTER TABLE "SeatingPlan" ADD COLUMN "weddingDayId" TEXT;
CREATE INDEX "SeatingPlan_weddingDayId_idx" ON "SeatingPlan"("weddingDayId");
ALTER TABLE "SeatingPlan"
  ADD CONSTRAINT "SeatingPlan_weddingDayId_fkey"
  FOREIGN KEY ("weddingDayId") REFERENCES "WeddingDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
