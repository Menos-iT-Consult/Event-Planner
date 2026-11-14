BEGIN;

DO $$ BEGIN
  CREATE TYPE "RegistrationStatus" AS ENUM ('CONFIRMED', 'WAITLISTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "JudgeScoreStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VOID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ContestRound" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "categoryId" TEXT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContestRound_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContestRound_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContestRound_eventId_name_key" ON "ContestRound"("eventId", "name");
CREATE INDEX IF NOT EXISTS "ContestRound_eventId_isPublished_idx" ON "ContestRound"("eventId", "isPublished");

CREATE TABLE IF NOT EXISTS "Sponsor" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tier" TEXT,
  "logoKey" TEXT,
  "website" TEXT,
  "description" TEXT,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Sponsor_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Sponsor_eventId_isPublished_idx" ON "Sponsor"("eventId", "isPublished");

CREATE TABLE IF NOT EXISTS "Exhibitor" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "logoKey" TEXT,
  "website" TEXT,
  "description" TEXT,
  "booth" TEXT,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Exhibitor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Exhibitor_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Exhibitor_eventId_isPublished_idx" ON "Exhibitor"("eventId", "isPublished");

CREATE TABLE IF NOT EXISTS "Judge" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Judge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Judge_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Judge_eventId_email_key" ON "Judge"("eventId", "email");
CREATE INDEX IF NOT EXISTS "Judge_eventId_active_idx" ON "Judge"("eventId", "active");

CREATE TABLE IF NOT EXISTS "JudgeScore" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "judgeId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "score" DECIMAL(8,2) NOT NULL,
  "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 100,
  "notes" TEXT,
  "status" "JudgeScoreStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JudgeScore_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JudgeScore_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JudgeScore_roundId_fkey"
    FOREIGN KEY ("roundId") REFERENCES "ContestRound"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JudgeScore_judgeId_fkey"
    FOREIGN KEY ("judgeId") REFERENCES "Judge"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "JudgeScore_roundId_judgeId_entryType_entryId_key"
  ON "JudgeScore"("roundId", "judgeId", "entryType", "entryId");
CREATE INDEX IF NOT EXISTS "JudgeScore_eventId_roundId_idx" ON "JudgeScore"("eventId", "roundId");

CREATE TABLE IF NOT EXISTS "SessionRegistration" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "status" "RegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionRegistration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionRegistration_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionRegistration_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionRegistration_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SessionRegistration_sessionId_email_key" ON "SessionRegistration"("sessionId", "email");
CREATE INDEX IF NOT EXISTS "SessionRegistration_eventId_status_idx" ON "SessionRegistration"("eventId", "status");

CREATE TABLE IF NOT EXISTS "SeatingAssignment" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "guestId" TEXT,
  "attendeeName" TEXT NOT NULL,
  "tableName" TEXT,
  "seatLabel" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeatingAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeatingAssignment_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SeatingAssignment_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "SeatingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SeatingAssignment_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SeatingAssignment_planId_attendeeName_key" ON "SeatingAssignment"("planId", "attendeeName");
CREATE INDEX IF NOT EXISTS "SeatingAssignment_eventId_planId_idx" ON "SeatingAssignment"("eventId", "planId");

CREATE TABLE IF NOT EXISTS "UserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "device" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");

CREATE TABLE IF NOT EXISTS "LoginAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL DEFAULT false,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoginAttempt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginAttempt_userId_createdAt_idx" ON "LoginAttempt"("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "eventId" TEXT,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PushSubscription_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_eventId_enabled_idx" ON "PushSubscription"("eventId", "enabled");

CREATE TABLE IF NOT EXISTS "PayoutAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "provider" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "bankCode" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayoutAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayoutAccount_provider_accountNumber_key" ON "PayoutAccount"("provider", "accountNumber");
CREATE INDEX IF NOT EXISTS "PayoutAccount_userId_isVerified_idx" ON "PayoutAccount"("userId", "isVerified");

CREATE TABLE IF NOT EXISTS "Payout" (
  "id" TEXT NOT NULL,
  "eventId" TEXT,
  "accountId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "providerRef" TEXT,
  "failureReason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payout_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Payout_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "PayoutAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Payout_providerRef_key" ON "Payout"("providerRef");
CREATE INDEX IF NOT EXISTS "Payout_accountId_status_idx" ON "Payout"("accountId", "status");
CREATE INDEX IF NOT EXISTS "Payout_eventId_status_idx" ON "Payout"("eventId", "status");

CREATE TABLE IF NOT EXISTS "WalletPass" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "passType" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "url" TEXT,
  "objectKey" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "WalletPass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletPass_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WalletPass_serialNumber_key" ON "WalletPass"("serialNumber");
CREATE INDEX IF NOT EXISTS "WalletPass_eventId_subjectType_subjectId_idx"
  ON "WalletPass"("eventId", "subjectType", "subjectId");

CREATE TABLE IF NOT EXISTS "Invite" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "inviterId" TEXT,
  "email" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'CHECK_IN_STAFF',
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invite_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Invite_inviterId_fkey"
    FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_tokenHash_key" ON "Invite"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_eventId_email_key" ON "Invite"("eventId", "email");
CREATE INDEX IF NOT EXISTS "Invite_eventId_acceptedAt_idx" ON "Invite"("eventId", "acceptedAt");

CREATE TABLE IF NOT EXISTS "AccessCode" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "label" TEXT,
  "maxUses" INTEGER,
  "uses" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccessCode_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccessCode_codeHash_key" ON "AccessCode"("codeHash");
CREATE INDEX IF NOT EXISTS "AccessCode_eventId_active_idx" ON "AccessCode"("eventId", "active");

COMMIT;
