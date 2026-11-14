import { OrganizationRole, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { getRouteParam } from "../lib/route-param.js";
import { createOpaqueToken } from "../lib/tokens.js";
import {
  requireAuth,
  requireAdminMfa,
  requireOrganizationAccess,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const organizationManagerRoles = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.EVENT_MANAGER,
] as const;
const organizationAdminRoles = [OrganizationRole.OWNER, OrganizationRole.ADMIN] as const;

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth, requireAdminMfa);

async function writeAudit(
  transaction: Prisma.TransactionClient,
  actorId: string,
  organizationId: string,
  action: string,
  entityId?: string,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      actorId,
      organizationId,
      action,
      entityType: "organization",
      entityId,
      metadata,
    },
  });
}

function createOrganizationSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${base || "organization"}-${createOpaqueToken().slice(0, 8)}`;
}

organizationsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = (request as AuthenticatedRequest).user!;
    const organizations = await prisma.organization.findMany({
      where: user.role === "ADMIN"
        ? undefined
        : { memberships: { some: { userId: user.id } } },
      include: {
        _count: { select: { memberships: true, events: true } },
        memberships: user.role === "ADMIN"
          ? { where: { userId: user.id }, select: { role: true } }
          : { where: { userId: user.id }, select: { role: true } },
      },
      orderBy: { name: "asc" },
    });
    response.json({
      organizations: organizations.map(({ memberships, ...organization }) => ({
        ...organization,
        role: memberships[0]?.role ?? (user.role === "ADMIN" ? "PLATFORM_ADMIN" : null),
      })),
    });
  }),
);

organizationsRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(2).max(160),
      description: z.string().trim().max(2000).optional(),
      website: z.string().url().optional(),
    }).parse(request.body);
    const actor = (request as AuthenticatedRequest).user!;
    if (actor.role === "CHECK_IN_STAFF") {
      response.status(403).json({ error: "Check-in staff cannot create organizations" });
      return;
    }
    const organization = await prisma.$transaction(async (transaction) => {
      const created = await transaction.organization.create({
        data: { ...input, slug: createOrganizationSlug(input.name) },
      });
      await transaction.organizationMembership.create({
        data: {
          userId: actor.id,
          organizationId: created.id,
          role: OrganizationRole.OWNER,
        },
      });
      await writeAudit(transaction, actor.id, created.id, "CREATE_ORGANIZATION", created.id);
      return created;
    });
    response.status(201).json({ organization, role: OrganizationRole.OWNER });
  }),
);

organizationsRouter.get(
  "/:organizationId",
  requireOrganizationAccess(...Object.values(OrganizationRole)),
  asyncHandler(async (request, response) => {
    const organizationId = getRouteParam(request, "organizationId");
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        website: true,
        logoKey: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!organization) {
      response.status(404).json({ error: "Organization not found" });
      return;
    }
    response.json({ organization });
  }),
);

organizationsRouter.get(
  "/:organizationId/events",
  requireOrganizationAccess(...Object.values(OrganizationRole)),
  asyncHandler(async (request, response) => {
    const organizationId = getRouteParam(request, "organizationId");
    const events = await prisma.event.findMany({
      where: { organizationId },
      select: {
        id: true,
        slug: true,
        title: true,
        type: true,
        startDate: true,
        endDate: true,
        location: true,
        totalCost: true,
        currency: true,
        _count: { select: { guests: true, orders: true } },
      },
      orderBy: { startDate: "asc" },
    });
    response.json({ events });
  }),
);

organizationsRouter.get(
  "/:organizationId/members",
  requireOrganizationAccess(...organizationAdminRoles),
  asyncHandler(async (request, response) => {
    const organizationId = getRouteParam(request, "organizationId");
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { name: true, email: true, emailVerifiedAt: true } },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    response.json({ members });
  }),
);

organizationsRouter.post(
  "/:organizationId/members",
  requireOrganizationAccess(...organizationAdminRoles),
  asyncHandler(async (request, response) => {
    const organizationId = getRouteParam(request, "organizationId");
    const input = z.object({
      email: z.string().email().transform((email) => email.toLowerCase()),
      role: z.nativeEnum(OrganizationRole),
    }).parse(request.body);
    const actor = (request as AuthenticatedRequest).user!;
    if (input.role === OrganizationRole.OWNER && actor.role !== "ADMIN") {
      const actorMembership = await prisma.organizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: actor.id,
            organizationId,
          },
        },
        select: { role: true },
      });
      if (actorMembership?.role !== OrganizationRole.OWNER) {
        response.status(403).json({ error: "Only an organization owner can assign another owner" });
        return;
      }
    }

    const target = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (!target) {
      response.status(404).json({ error: "Create the account before adding it to this organization" });
      return;
    }
    const membership = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
      const current = await transaction.organizationMembership.findUnique({
        where: {
          userId_organizationId: { userId: target.id, organizationId },
        },
        select: { role: true },
      });
      if (current?.role === OrganizationRole.OWNER && input.role !== OrganizationRole.OWNER) {
        const ownerCount = await transaction.organizationMembership.count({
          where: { organizationId, role: OrganizationRole.OWNER },
        });
        if (ownerCount <= 1) return { error: "last_owner" as const };
      }
      if (!current && actor.role !== "ADMIN") {
        const now = new Date();
        const subscription = await transaction.organizerSubscription.findFirst({
          where: {
            organizationId,
            status: { in: ["ACTIVE", "TRIALING"] },
            currentPeriodStart: { lte: now },
            currentPeriodEnd: { gt: now },
          },
          include: { plan: { select: { maxMembers: true } } },
          orderBy: { currentPeriodEnd: "desc" },
        });
        if (subscription?.plan.maxMembers !== null && subscription?.plan.maxMembers !== undefined) {
          const memberCount = await transaction.organizationMembership.count({ where: { organizationId } });
          if (memberCount >= subscription.plan.maxMembers) return { error: "member_limit" as const };
        }
      }
      const updatedMembership = await transaction.organizationMembership.upsert({
        where: {
          userId_organizationId: {
            userId: target.id,
            organizationId,
          },
        },
        create: {
          userId: target.id,
          organizationId,
          role: input.role,
        },
        update: { role: input.role },
        select: { userId: true, role: true, createdAt: true },
      });
      await writeAudit(transaction, actor.id, organizationId, "UPSERT_ORGANIZATION_MEMBER", target.id, {
        role: input.role,
      });
      return { membership: updatedMembership };
    });
    if ("error" in membership) {
      if (membership.error === "member_limit") {
        response.status(402).json({
          error: "Your current subscription has reached its member limit",
          code: "SUBSCRIPTION_MEMBER_LIMIT",
        });
        return;
      }
      response.status(409).json({ error: "An organization must retain at least one owner" });
      return;
    }
    response.status(200).json({ membership: membership.membership });
  }),
);

organizationsRouter.delete(
  "/:organizationId/members/:userId",
  requireOrganizationAccess(...organizationAdminRoles),
  asyncHandler(async (request, response) => {
    const organizationId = getRouteParam(request, "organizationId");
    const userId = getRouteParam(request, "userId");
    const actor = (request as AuthenticatedRequest).user!;
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
      const membership = await transaction.organizationMembership.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
      });
      if (!membership) return "not_found" as const;
      if (membership.role === OrganizationRole.OWNER) {
        const ownerCount = await transaction.organizationMembership.count({
          where: { organizationId, role: OrganizationRole.OWNER },
        });
        if (ownerCount <= 1) return "last_owner" as const;
      }
      await transaction.organizationMembership.delete({
        where: { userId_organizationId: { userId, organizationId } },
      });
      await writeAudit(transaction, actor.id, organizationId, "REMOVE_ORGANIZATION_MEMBER", userId);
      return "deleted" as const;
    });
    if (result === "last_owner") {
      response.status(409).json({ error: "An organization must retain at least one owner" });
      return;
    }
    if (result === "not_found") {
      response.status(404).json({ error: "Organization member not found" });
      return;
    }
    response.status(204).end();
  }),
);

organizationsRouter.get(
  "/:organizationId/audit",
  requireOrganizationAccess(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.AUDITOR,
  ),
  asyncHandler(async (request, response) => {
    const organizationId = getRouteParam(request, "organizationId");
    const input = z.object({
      q: z.string().trim().max(100).optional(),
    }).parse(request.query);
    const logs = await prisma.auditLog.findMany({
      where: {
        organizationId,
        ...(input.q
          ? {
              OR: [
                { action: { contains: input.q, mode: "insensitive" } },
                { entityType: { contains: input.q, mode: "insensitive" } },
                { entityId: { contains: input.q, mode: "insensitive" } },
                { actor: { is: { name: { contains: input.q, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      take: 100,
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    response.json({ logs });
  }),
);
