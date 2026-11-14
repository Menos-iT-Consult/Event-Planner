import { OrganizationRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  canManageOrganization,
  canManageOrganizationEvents,
  canViewOrganizationAudit,
} from "../src/lib/authorization.js";

describe("organization authorization", () => {
  it("allows only owners and administrators to manage organization membership", () => {
    expect(canManageOrganization(OrganizationRole.OWNER)).toBe(true);
    expect(canManageOrganization(OrganizationRole.ADMIN)).toBe(true);
    expect(canManageOrganization(OrganizationRole.EVENT_MANAGER)).toBe(false);
    expect(canManageOrganization(OrganizationRole.FINANCE)).toBe(false);
    expect(canManageOrganization(OrganizationRole.AUDITOR)).toBe(false);
  });

  it("keeps finance and auditor roles out of event-management access", () => {
    expect(canManageOrganizationEvents(OrganizationRole.OWNER)).toBe(true);
    expect(canManageOrganizationEvents(OrganizationRole.ADMIN)).toBe(true);
    expect(canManageOrganizationEvents(OrganizationRole.EVENT_MANAGER)).toBe(true);
    expect(canManageOrganizationEvents(OrganizationRole.FINANCE)).toBe(false);
    expect(canManageOrganizationEvents(OrganizationRole.AUDITOR)).toBe(false);
  });

  it("grants audit visibility only to accountable organization roles", () => {
    expect(canViewOrganizationAudit(OrganizationRole.OWNER)).toBe(true);
    expect(canViewOrganizationAudit(OrganizationRole.ADMIN)).toBe(true);
    expect(canViewOrganizationAudit(OrganizationRole.AUDITOR)).toBe(true);
    expect(canViewOrganizationAudit(OrganizationRole.EVENT_MANAGER)).toBe(false);
    expect(canViewOrganizationAudit(OrganizationRole.FINANCE)).toBe(false);
  });
});
