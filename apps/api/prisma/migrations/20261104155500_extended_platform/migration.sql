CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD');
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL', 'VOTE', 'CHECK_IN');

CREATE TABLE "VerificationToken" (
  "id" TEXT NOT NULL, "userId" TEXT, "purpose" "VerificationPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");
CREATE INDEX "VerificationToken_purpose_expiresAt_idx" ON "VerificationToken"("purpose", "expiresAt");

CREATE TABLE "TwoFactorCredential" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "secret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "verifiedAt" TIMESTAMP(3),
  "backupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[], "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TwoFactorCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TwoFactorCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TwoFactorCredential_userId_key" ON "TwoFactorCredential"("userId");

CREATE TABLE "ConsentRecord" (
  "id" TEXT NOT NULL, "userId" TEXT, "eventId" TEXT, "subjectType" TEXT NOT NULL, "subjectId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL, "version" TEXT NOT NULL, "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" TEXT,
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ConsentRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ConsentRecord_subjectType_subjectId_idx" ON "ConsentRecord"("subjectType", "subjectId");
CREATE INDEX "ConsentRecord_eventId_documentType_idx" ON "ConsentRecord"("eventId", "documentType");

CREATE TABLE "DataDeletionRequest" (
  "id" TEXT NOT NULL, "userId" TEXT, "email" TEXT NOT NULL, "reason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "DataDeletionRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "DataDeletionRequest_email_requestedAt_idx" ON "DataDeletionRequest"("email", "requestedAt");

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "orderType" TEXT NOT NULL, "orderId" TEXT NOT NULL,
  "paymentReference" TEXT, "amount" DECIMAL(12,2) NOT NULL, "currency" TEXT NOT NULL DEFAULT 'GHS',
  "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED', "reason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Refund_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Refund_eventId_status_idx" ON "Refund"("eventId", "status");
CREATE INDEX "Refund_paymentReference_idx" ON "Refund"("paymentReference");

CREATE TABLE "WaitlistEntry" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL,
  "phone" TEXT, "tierId" TEXT, "notified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaitlistEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WaitlistEntry_eventId_email_key" ON "WaitlistEntry"("eventId", "email");
CREATE INDEX "WaitlistEntry_eventId_notified_idx" ON "WaitlistEntry"("eventId", "notified");

CREATE TABLE "PromoCode" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "code" TEXT NOT NULL, "percentOff" DECIMAL(5,2),
  "amountOff" DECIMAL(12,2), "maxRedemptions" INTEGER, "redemptions" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3), "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PromoCode_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PromoCode_eventId_code_key" ON "PromoCode"("eventId", "code");

CREATE TABLE "Seat" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "section" TEXT NOT NULL, "row" TEXT NOT NULL,
  "number" TEXT NOT NULL, "reservedBy" TEXT, "ticketId" TEXT, "reservedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Seat_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Seat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Seat_eventId_section_row_number_key" ON "Seat"("eventId", "section", "row", "number");
CREATE INDEX "Seat_eventId_reservedBy_idx" ON "Seat"("eventId", "reservedBy");

CREATE TABLE "Survey" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
  "questions" JSONB NOT NULL, "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Survey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Survey_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Survey_eventId_isPublished_idx" ON "Survey"("eventId", "isPublished");

CREATE TABLE "SurveyResponse" (
  "id" TEXT NOT NULL, "surveyId" TEXT NOT NULL, "answers" JSONB NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Certificate" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "recipientName" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL, "title" TEXT NOT NULL, "objectKey" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Certificate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Certificate_eventId_recipientEmail_idx" ON "Certificate"("eventId", "recipientEmail");

CREATE TABLE "RecurringSchedule" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "frequency" TEXT NOT NULL, "interval" INTEGER NOT NULL DEFAULT 1,
  "weekday" INTEGER, "dayOfMonth" INTEGER, "until" TIMESTAMP(3), "timezone" TEXT NOT NULL DEFAULT 'Africa/Accra',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurringSchedule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RecurringSchedule_eventId_until_idx" ON "RecurringSchedule"("eventId", "until");

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "number" TEXT NOT NULL, "customerName" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL, "subtotal" DECIMAL(12,2) NOT NULL, "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0, "total" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GHS', "status" TEXT NOT NULL DEFAULT 'ISSUED',
  "lines" JSONB NOT NULL, "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "dueAt" TIMESTAMP(3),
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invoice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX "Invoice_eventId_status_idx" ON "Invoice"("eventId", "status");

CREATE TABLE "BackgroundJob" (
  "id" TEXT NOT NULL, "eventId" TEXT, "type" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED', "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5, "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackgroundJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "BackgroundJob_status_runAt_idx" ON "BackgroundJob"("status", "runAt");
CREATE INDEX "BackgroundJob_eventId_type_idx" ON "BackgroundJob"("eventId", "type");
