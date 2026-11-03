import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  clearSessionCookie,
  createSessionToken,
  requireAuth,
  setSessionCookie,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const credentialsSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const authRouter = Router();

authRouter.post(
  "/signup",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many account requests. Please try again later." },
  }),
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email().transform((email) => email.toLowerCase()),
      password: z.string().min(12).max(200),
      confirmPassword: z.string().min(12).max(200),
    }).refine((value) => value.password === value.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    }).parse(request.body);

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      response.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: "EVENT_MANAGER",
      },
      select: { id: true, name: true, email: true, role: true },
    });
    setSessionCookie(response, createSessionToken(user));
    response.status(201).json({ user });
  }),
);

authRouter.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again later." },
  }),
  asyncHandler(async (request, response) => {
    const credentials = credentialsSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: credentials.email },
    });
    const passwordMatches = user
      ? await bcrypt.compare(credentials.password, user.passwordHash)
      : false;
    if (!user || !passwordMatches) {
      response.status(401).json({ error: "Email or password is incorrect" });
      return;
    }

    setSessionCookie(response, createSessionToken(user));
    response.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }),
);

authRouter.post("/logout", (_request, response) => {
  clearSessionCookie(response);
  response.status(204).end();
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (request, response) => {
    const { id } = (request as AuthenticatedRequest).user!;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!user) {
      response.status(401).json({ error: "Account is no longer available" });
      return;
    }
    response.json({ user });
  }),
);
