CREATE TYPE "OrganizationRole" AS ENUM (
  'OWNER',
  'ADMIN',
  'EVENT_MANAGER',
  'FINANCE',
  'AUDITOR'
);

CREATE TABLE "OrganizationMembership" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "role" "OrganizationRole" NOT NULL DEFAULT 'EVENT_MANAGER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrganizationMembership_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrganizationMembership_userId_organizationId_key"
  ON "OrganizationMembership"("userId", "organizationId");
CREATE INDEX "OrganizationMembership_organizationId_role_idx"
  ON "OrganizationMembership"("organizationId", "role");
CREATE INDEX "OrganizationMembership_userId_idx"
  ON "OrganizationMembership"("userId");

ALTER TABLE "Event" ADD COLUMN "organizationId" TEXT;

INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt")
SELECT
  'personal-' || "id",
  left("name", 140) || '''s organization',
  'personal-' || replace("id", '-', ''),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE "organizationId" IS NULL
  AND "role" <> 'CHECK_IN_STAFF'
ON CONFLICT ("id") DO NOTHING;

UPDATE "User"
SET "organizationId" = 'personal-' || "id"
WHERE "organizationId" IS NULL
  AND "role" <> 'CHECK_IN_STAFF';

INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "createdAt", "updatedAt")
SELECT
  'legacy-user-org-' || "id",
  "id",
  "organizationId",
  CASE
    WHEN "organizationId" = 'personal-' || "id" THEN 'OWNER'::"OrganizationRole"
    ELSE 'EVENT_MANAGER'::"OrganizationRole"
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE "organizationId" IS NOT NULL
  AND "role" <> 'CHECK_IN_STAFF'
ON CONFLICT ("userId", "organizationId") DO NOTHING;

UPDATE "Event" AS event
SET "organizationId" = (
  SELECT "User"."organizationId"
  FROM "EventMembership"
  JOIN "User" ON "User"."id" = "EventMembership"."userId"
  WHERE "EventMembership"."eventId" = event."id"
    AND "EventMembership"."role" = 'EVENT_MANAGER'
    AND "User"."role" <> 'CHECK_IN_STAFF'
    AND "User"."organizationId" IS NOT NULL
  ORDER BY "EventMembership"."createdAt", "EventMembership"."id"
  LIMIT 1
);

INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt")
SELECT
  'legacy-event-' || "id",
  left("title", 150),
  'legacy-event-' || replace("id", '-', ''),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Event"
WHERE "organizationId" IS NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "Event"
SET "organizationId" = 'legacy-event-' || "id"
WHERE "organizationId" IS NULL;

INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "createdAt", "updatedAt")
SELECT DISTINCT
  'legacy-event-member-' || md5("EventMembership"."userId" || ':' || "Event"."organizationId"),
  "EventMembership"."userId",
  "Event"."organizationId",
  'EVENT_MANAGER'::"OrganizationRole",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "EventMembership"
JOIN "Event" ON "Event"."id" = "EventMembership"."eventId"
JOIN "User" ON "User"."id" = "EventMembership"."userId"
WHERE "EventMembership"."role" = 'EVENT_MANAGER'
  AND "User"."role" <> 'CHECK_IN_STAFF'
ON CONFLICT ("userId", "organizationId") DO NOTHING;

ALTER TABLE "Event" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "eventId" TEXT;
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Event_organizationId_idx" ON "Event"("organizationId");
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_eventId_createdAt_idx" ON "AuditLog"("eventId", "createdAt");
