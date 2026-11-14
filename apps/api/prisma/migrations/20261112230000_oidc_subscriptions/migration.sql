CREATE TYPE "BillingProvider" AS ENUM ('PAYSTACK', 'MOOLRE');
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

ALTER TABLE "SubscriptionPlan"
  ADD COLUMN "maxEvents" INTEGER,
  ADD COLUMN "maxMembers" INTEGER;

CREATE TABLE "ExternalIdentity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExternalIdentity_issuer_subject_key" ON "ExternalIdentity"("issuer", "subject");
CREATE INDEX "ExternalIdentity_userId_idx" ON "ExternalIdentity"("userId");

CREATE TABLE "OidcLoginRequest" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "browserTokenHash" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "codeVerifier" TEXT NOT NULL,
  "returnTo" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OidcLoginRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OidcLoginRequest_stateHash_key" ON "OidcLoginRequest"("stateHash");
CREATE INDEX "OidcLoginRequest_expiresAt_idx" ON "OidcLoginRequest"("expiresAt");

CREATE TABLE "SubscriptionInvoice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "provider" "BillingProvider" NOT NULL,
  "reference" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GHS',
  "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "checkoutUrl" TEXT,
  "expiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionInvoice_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubscriptionInvoice_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubscriptionInvoice_reference_key" ON "SubscriptionInvoice"("reference");
CREATE INDEX "SubscriptionInvoice_organizationId_status_createdAt_idx"
  ON "SubscriptionInvoice"("organizationId", "status", "createdAt");
