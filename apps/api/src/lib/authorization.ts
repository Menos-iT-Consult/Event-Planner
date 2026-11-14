import { OrganizationRole } from "@prisma/client";

export function canManageOrganization(role: OrganizationRole | undefined): boolean {
  return role === OrganizationRole.OWNER || role === OrganizationRole.ADMIN;
}

export function canManageOrganizationEvents(role: OrganizationRole | undefined): boolean {
  return canManageOrganization(role) || role === OrganizationRole.EVENT_MANAGER;
}

export function canViewOrganizationAudit(role: OrganizationRole | undefined): boolean {
  return canManageOrganization(role) || role === OrganizationRole.AUDITOR;
}
