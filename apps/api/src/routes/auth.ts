import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createHmac, randomBytes } from "node:crypto";
import { createOpaqueToken, hashOpaqueToken } from "../lib/tokens.js";
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
  code: z.string().trim().regex(/^(\d{6}|[A-F0-9]{10})$/i).optional(),
});

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function createBase32Secret(bytes = 20): string {
  const value = randomBytes(bytes);
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let encoded = "";
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5);
    if (chunk.length === 5) encoded += base32Alphabet[Number.parseInt(chunk, 2)];
  }
  return encoded;
}

function base32Decode(secret: string): Buffer {
  const normalized = secret.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const value = base32Alphabet.indexOf(character);
    if (value >= 0) bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 30_000);
  const key = base32Decode(secret);
  for (const offset of [-1, 0, 1]) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter + offset));
    const digest = createHmac("sha1", key).update(buffer).digest();
    const position = digest[digest.length - 1]! & 0xf;
    const value = (
      ((digest[position]! & 0x7f) << 24) |
      ((digest[position + 1]! & 0xff) << 16) |
      ((digest[position + 2]! & 0xff) << 8) |
      (digest[position + 3]! & 0xff)
    ) % 1_000_000;
    if (value.toString().padStart(6, "0") === code) return true;
  }
  return false;
}

export const authRouter = Router();

authRouter.post(
  "/forgot-password",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many recovery requests. Please try again later." },
  }),
  asyncHandler(async (request, response) => {
    const input = z.object({
      email: z.string().email().transform((email) => email.toLowerCase()),
    }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true, email: true } });
    if (user) {
      const token = createOpaqueToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashOpaqueToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await prisma.backgroundJob.create({
        data: {
          type: "SEND_EMAIL",
          payload: {
            to: user.email,
            subject: "Reset your EventFlow password",
            text: `Reset your EventFlow password:\n${process.env.WEB_ORIGIN ?? "http://localhost:5173"}/reset-password?token=${encodeURIComponent(token)}\n\nThis link expires in 60 minutes. If you did not request it, you can ignore this email.`,
          },
        },
      });
    }
    response.json({
      message: "If password recovery is available for this account, an administrator will assist with resetting it.",
    });
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (request, response) => {
    const input = z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(8).max(200),
    }).parse(request.body);
    const authUser = (request as AuthenticatedRequest).user!;
    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      response.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(input.newPassword, 12) },
    });
    response.json({ changed: true });
  }),
);

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
      password: z.string().min(8).max(200),
      confirmPassword: z.string().min(8).max(200),
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
    const twoFactor = await prisma.twoFactorCredential.findUnique({ where: { userId: user.id } });
    if (twoFactor?.enabled) {
      const twoFactorCode = credentials.code?.trim().toUpperCase();
      const totpValid = twoFactorCode ? verifyTotp(twoFactor.secret, twoFactorCode) : false;
      const backupIndex = twoFactorCode ? twoFactor.backupCodes.findIndex((value) => value === twoFactorCode) : -1;
      if (!totpValid && backupIndex < 0) {
        response.status(401).json({ error: "A valid two-factor authentication code is required", mfaRequired: true });
        return;
      }
      if (backupIndex >= 0) {
        const remaining = [...twoFactor.backupCodes];
        remaining.splice(backupIndex, 1);
        await prisma.twoFactorCredential.update({
          where: { userId: user.id },
          data: { backupCodes: remaining },
        });
      }
    }

    setSessionCookie(response, createSessionToken(user));
    response.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }),
);

authRouter.post(
  "/verify-email/request",
  requireAuth,
  asyncHandler(async (request, response) => {
    const authUser = (request as AuthenticatedRequest).user!;
    const token = createOpaqueToken();
    await prisma.verificationToken.create({
      data: {
        userId: authUser.id,
        purpose: "EMAIL",
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const user = await prisma.user.findUnique({ where: { id: authUser.id }, select: { email: true } });
    if (user) {
      await prisma.backgroundJob.create({
        data: {
          type: "SEND_EMAIL",
          payload: {
            to: user.email,
            subject: "Verify your EventFlow email address",
            text: `Use this verification token: ${token}\nThis token expires in 24 hours.`,
          },
        },
      });
    }
    response.json({ verificationRequired: true, delivery: "QUEUED" });
  }),
);

authRouter.post(
  "/verify-email/confirm",
  asyncHandler(async (request, response) => {
    const input = z.object({ token: z.string().min(32).max(200) }).parse(request.body);
    const record = await prisma.verificationToken.findFirst({
      where: {
        tokenHash: hashOpaqueToken(input.token),
        purpose: "EMAIL",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!record?.userId) {
      response.status(400).json({ error: "Verification link is invalid or expired" });
      return;
    }
    await prisma.$transaction([
      prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    response.json({ verified: true });
  }),
);

authRouter.post(
  "/2fa/setup",
  requireAuth,
  asyncHandler(async (request, response) => {
    const authUser = (request as AuthenticatedRequest).user!;
    const secret = createBase32Secret();
    const backupCodes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex").slice(0, 10).toUpperCase());
    await prisma.twoFactorCredential.upsert({
      where: { userId: authUser.id },
      create: { userId: authUser.id, secret, backupCodes },
      update: { secret, enabled: false, verifiedAt: null, backupCodes },
    });
    response.json({ secret, backupCodes });
  }),
);

authRouter.post(
  "/2fa/verify",
  requireAuth,
  asyncHandler(async (request, response) => {
    const authUser = (request as AuthenticatedRequest).user!;
    const input = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const credential = await prisma.twoFactorCredential.findUnique({ where: { userId: authUser.id } });
    if (!credential || !verifyTotp(credential.secret, input.code)) {
      response.status(400).json({ error: "Invalid authentication code" });
      return;
    }
    await prisma.twoFactorCredential.update({
      where: { userId: authUser.id },
      data: { enabled: true, verifiedAt: new Date() },
    });
    response.json({ enabled: true });
  }),
);

authRouter.post(
  "/2fa/disable",
  requireAuth,
  asyncHandler(async (request, response) => {
    const authUser = (request as AuthenticatedRequest).user!;
    const input = z.object({
      password: z.string().min(1).max(200),
    }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      response.status(400).json({ error: "Password is incorrect" });
      return;
    }
    await prisma.twoFactorCredential.deleteMany({ where: { userId: authUser.id } });
    response.json({ disabled: true });
  }),
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (request, response) => {
    const input = z.object({
      token: z.string().min(32).max(200),
      password: z.string().min(8).max(200),
      confirmPassword: z.string().min(8).max(200),
    }).refine((value) => value.password === value.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    }).parse(request.body);
    const record = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: hashOpaqueToken(input.token),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true },
    });
    if (!record) {
      response.status(400).json({ error: "Reset link is invalid or expired" });
      return;
    }
    await prisma.$transaction([
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await bcrypt.hash(input.password, 12) },
      }),
    ]);
    response.json({ reset: true });
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
