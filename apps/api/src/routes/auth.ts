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
