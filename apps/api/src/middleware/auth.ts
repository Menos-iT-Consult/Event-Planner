import type { NextFunction, Request, Response } from "express";
import type { OrganizationRole, UserRole } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { canManageOrganizationEvents } from "../lib/authorization.js";
import { createOpaqueToken, hashOpaqueToken } from "../lib/tokens.js";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: UserRole; mfaEnabled: boolean };
}

function asyncGuard(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

const cookieName = "eventflow_session";
const sessionTtlMs = (() => {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(config.JWT_EXPIRES_IN);
  if (!match) throw new Error("JWT_EXPIRES_IN must be a positive duration such as 8h");
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return value * multiplier;
})();

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(cookieName, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: sessionTtlMs,
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(cookieName, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
}

export async function createSessionToken(
  user: { id: string },
  request: Request,
): Promise<string> {
  const token = createOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlMs);
  const userAgent = request.get("user-agent");
  await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(token),
      device: userAgent ? userAgent.slice(0, 500) : null,
      userAgent: userAgent ? userAgent.slice(0, 1000) : null,
      expiresAt,
      lastUsedAt: now,
    },
  });
  return token;
}

export async function revokeSessionToken(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.userSession.updateMany({
    where: { tokenHash: hashOpaqueToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export const requireAuth = asyncGuard(async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  const token = request.cookies?.[cookieName] as string | undefined;
  if (!token) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  const now = new Date();
  const session = await prisma.userSession.findFirst({
    where: {
      tokenHash: hashOpaqueToken(token),
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true, userId: true, lastUsedAt: true },
  });
  if (!session) {
    response.status(401).json({ error: "Session is invalid or expired" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      role: true,
      twoFactor: { select: { enabled: true } },
    },
  });
  if (!user) {
    response.status(401).json({ error: "Account is no longer available" });
    return;
  }
  if (!session.lastUsedAt || now.getTime() - session.lastUsedAt.getTime() >= 5 * 60 * 1000) {
    const refreshed = await prisma.userSession.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
    if (refreshed.count !== 1) {
      response.status(401).json({ error: "Session is invalid or expired" });
      return;
    }
  }
  (request as AuthenticatedRequest).user = {
    id: user.id,
    role: user.role,
    mfaEnabled: Boolean(user.twoFactor?.enabled),
  };
  response.locals.sessionId = session.id;
  next();
});

export function requireRole(...roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const user = (request as AuthenticatedRequest).user;
    if (!user || !roles.includes(user.role)) {
      response.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export const requireAdminMfa = asyncGuard(async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  const user = (request as AuthenticatedRequest).user;
  if (user?.role === "ADMIN" && !user.mfaEnabled) {
    response.status(403).json({
      error: "Two-factor authentication is required for platform administrators",
      code: "MFA_SETUP_REQUIRED",
    });
    return;
  }
  next();
});

export const requireEventAccess = asyncGuard(async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  const user = (request as AuthenticatedRequest).user;
  const eventId = request.params.eventId;
  if (!user || !eventId) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  if (user.role === "ADMIN") {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    response.locals.eventId = eventId;
    response.locals.organizationId = event.organizationId;
    next();
    return;
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true },
  });
  if (!event) {
    response.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await prisma.eventMembership.findUnique({
    where: { userId_eventId: { userId: user.id, eventId } },
  });
  if (membership?.role === "EVENT_MANAGER") {
    if (user.role === "CHECK_IN_STAFF") {
      response.status(403).json({ error: "Check-in staff cannot manage this event" });
      return;
    }
    response.locals.eventId = eventId;
    response.locals.organizationId = event.organizationId;
    next();
    return;
  }

  if (user.role === "CHECK_IN_STAFF") {
    response.status(403).json({ error: "Check-in staff cannot manage this event" });
    return;
  }
  const organizationMembership = await prisma.organizationMembership.findUnique({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: event.organizationId,
      },
    },
    select: { role: true },
  });
  if (!canManageOrganizationEvents(organizationMembership?.role)) {
    response.status(403).json({ error: "You do not have manager access to this event" });
    return;
  }
  response.locals.eventId = eventId;
  response.locals.organizationId = event.organizationId;
  next();
});

export function requireOrganizationAccess(...roles: OrganizationRole[]) {
  return asyncGuard(async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const user = (request as AuthenticatedRequest).user;
    const organizationId = request.params.organizationId;
    if (!user || !organizationId) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!organization) {
      response.status(404).json({ error: "Organization not found" });
      return;
    }

    if (user.role === "ADMIN") {
      response.locals.organizationId = organizationId;
      next();
      return;
    }

    const membership = await prisma.organizationMembership.findUnique({
      where: {
        userId_organizationId: { userId: user.id, organizationId },
      },
      select: { role: true },
    });
    if (!membership || !roles.includes(membership.role)) {
      response.status(403).json({ error: "You do not have access to this organization" });
      return;
    }

    response.locals.organizationId = organizationId;
    response.locals.organizationRole = membership.role;
    next();
  });
}

export const requireEventStaffAccess = asyncGuard(async (
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  const user = (request as AuthenticatedRequest).user;
  const eventId = request.params.eventId;
  if (!user || !eventId) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  if (user.role === "ADMIN") {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    response.locals.eventId = eventId;
    response.locals.organizationId = event.organizationId;
    next();
    return;
  }
  const membership = await prisma.eventMembership.findUnique({
    where: { userId_eventId: { userId: user.id, eventId } },
  });
  if (!membership || !["EVENT_MANAGER", "CHECK_IN_STAFF"].includes(membership.role)) {
    response.status(403).json({ error: "You do not have staff access to this event" });
    return;
  }
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true },
  });
  if (!event) {
    response.status(404).json({ error: "Event not found" });
    return;
  }
  response.locals.eventId = eventId;
  response.locals.organizationId = event.organizationId;
  next();
});
