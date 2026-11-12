CREATE TYPE "MessageAudience" AS ENUM ('ALL_GUESTS', 'ATTENDING');
CREATE TYPE "MessageScheduleStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

CREATE TABLE "SmsPreference" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "phoneHash" TEXT NOT NULL,
  "optOutTokenHash" TEXT NOT NULL,
  "optedOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmsPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SmsPreference_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SmsPreference_optOutTokenHash_key" ON "SmsPreference"("optOutTokenHash");
CREATE UNIQUE INDEX "SmsPreference_eventId_phoneHash_key" ON "SmsPreference"("eventId", "phoneHash");
CREATE INDEX "SmsPreference_eventId_optedOutAt_idx" ON "SmsPreference"("eventId", "optedOutAt");

CREATE TABLE "EventMessageSchedule" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "createdById" TEXT,
  "audience" "MessageAudience" NOT NULL DEFAULT 'ALL_GUESTS',
  "message" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" "MessageScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventMessageSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventMessageSchedule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventMessageSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "EventMessageSchedule_eventId_status_scheduledAt_idx" ON "EventMessageSchedule"("eventId", "status", "scheduledAt");

CREATE TABLE "ProviderHealthCheck" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "details" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderHealthCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderHealthCheck_provider_checkedAt_idx" ON "ProviderHealthCheck"("provider", "checkedAt");
