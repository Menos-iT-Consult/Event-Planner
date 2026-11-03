import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: UserRole };
}

function asyncGuard(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

const cookieName = "eventflow_session";

export function setSessionCookie(response: Response, token: string): void {
  response.cookie(cookieName, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
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

export function createSessionToken(user: { id: string; role: UserRole }): string {
  return jwt.sign({ role: user.role }, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
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

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch {
    response.status(401).json({ error: "Session is invalid or expired" });
    return;
  }
  if (typeof payload === "string" || !payload.sub) {
    response.status(401).json({ error: "Invalid session" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true },
  });
  if (!user) {
    response.status(401).json({ error: "Account is no longer available" });
    return;
  }
  (request as AuthenticatedRequest).user = user;
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
    next();
    return;
  }

  const membership = await prisma.eventMembership.findUnique({
    where: { userId_eventId: { userId: user.id, eventId } },
  });
  if (!membership || membership.role !== "EVENT_MANAGER") {
    response.status(403).json({ error: "You do not have manager access to this event" });
    return;
  }
  next();
});

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
  next();
});
