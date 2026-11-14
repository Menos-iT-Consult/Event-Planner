import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { PasswordResetPurpose } from "@prisma/client";
import QRCode from "qrcode";
import { z } from "zod";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createOpaqueToken, hashOpaqueToken } from "../lib/tokens.js";
import { decryptText, encryptText } from "../lib/encryption.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  discoverOidcProvider,
  exchangeOidcCode,
  getAllowedOidcEmailDomains,
  isOidcConfigured,
  isSafeReturnPath,
} from "../services/oidc.js";
import {
  clearSessionCookie,
  createSessionToken,
  requireAuth,
  revokeSessionToken,
  setSessionCookie,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const credentialsSchema = z.object({
  email: z.string().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(200),
  code: z.string().trim().regex(/^(\d{6}|[A-F0-9]{10})$/i).optional(),
});

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const totpEncryptionKey = createHash("sha256")
  .update(config.MFA_ENCRYPTION_KEY ?? config.JWT_SECRET)
  .digest();

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

const oidcBrowserCookie = "eventflow_oidc";

authRouter.get("/oidc/status", (_request, response) => {
  response.json({ enabled: isOidcConfigured() });
});

authRouter.get(
  "/oidc/start",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
  asyncHandler(async (request, response) => {
    const discovery = await discoverOidcProvider();
    const state = createOpaqueToken();
    const browserToken = createOpaqueToken();
    const nonce = createOpaqueToken();
    const codeVerifier = createOpaqueToken();
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await prisma.oidcLoginRequest.create({
      data: {
        stateHash: hashOpaqueToken(state),
        browserTokenHash: hashOpaqueToken(browserToken),
        nonceHash: hashOpaqueToken(nonce),
        codeVerifier: encryptText(codeVerifier, totpEncryptionKey),
        returnTo: isSafeReturnPath(typeof request.query.next === "string" ? request.query.next : undefined),
        expiresAt,
      },
    });
    response.cookie(oidcBrowserCookie, browserToken, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/api/auth/oidc",
      maxAge: 10 * 60_000,
    });
    const authorization = new URL(discovery.authorization_endpoint);
    authorization.search = new URLSearchParams({
      client_id: config.OIDC_CLIENT_ID!,
      response_type: "code",
      scope: "openid email profile",
      redirect_uri: `${config.API_ORIGIN}/api/auth/oidc/callback`,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    response.redirect(302, authorization.toString());
  }),
);

authRouter.get(
  "/oidc/callback",
  asyncHandler(async (request, response) => {
    const loginUrl = new URL("/login", config.WEB_ORIGIN);
    if (typeof request.query.error === "string") {
      loginUrl.searchParams.set("error", "sso_failed");
      response.clearCookie(oidcBrowserCookie, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: "lax",
        path: "/api/auth/oidc",
      });
      response.redirect(302, loginUrl.toString());
      return;
    }

    const input = z.object({
      state: z.string().min(20).max(200),
      code: z.string().min(1).max(4000),
    }).safeParse(request.query);
    const browserToken = request.cookies?.[oidcBrowserCookie] as string | undefined;
    if (!input.success || !browserToken) {
      response.status(400).json({ error: "OIDC login response is invalid or expired" });
      return;
    }
    const loginRequest = await prisma.oidcLoginRequest.findFirst({
      where: {
        stateHash: hashOpaqueToken(input.data.state),
        browserTokenHash: hashOpaqueToken(browserToken),
        expiresAt: { gt: new Date() },
      },
    });
    if (!loginRequest) {
      response.status(400).json({ error: "OIDC login response is invalid or expired" });
      return;
    }
    const consumed = await prisma.oidcLoginRequest.deleteMany({
      where: { id: loginRequest.id, expiresAt: { gt: new Date() } },
    });
    response.clearCookie(oidcBrowserCookie, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/api/auth/oidc",
    });
    if (consumed.count !== 1) {
      response.status(400).json({ error: "OIDC login response has already been used" });
      return;
    }

    const claims = await exchangeOidcCode({
      code: input.data.code,
      codeVerifier: decryptText(loginRequest.codeVerifier, totpEncryptionKey),
      nonce: loginRequest.nonceHash,
      redirectUri: `${config.API_ORIGIN}/api/auth/oidc/callback`,
    });
    if (claims.email_verified !== true || typeof claims.email !== "string") {
      response.redirect(302, `${loginUrl.toString()}?error=sso_account_unavailable`);
      return;
    }
    const email = claims.email.trim().toLowerCase();
    const allowedDomains = getAllowedOidcEmailDomains();
    const emailDomain = email.split("@")[1];
    if (!emailDomain || (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain))) {
      response.redirect(302, `${loginUrl.toString()}?error=sso_account_unavailable`);
      return;
    }

    const existingIdentity = await prisma.externalIdentity.findUnique({
      where: { issuer_subject: { issuer: claims.iss!, subject: claims.sub! } },
      include: { user: { select: { id: true, name: true, email: true, role: true, disabledAt: true } } },
    });
    let user = existingIdentity?.user;
    if (user?.disabledAt) {
      response.redirect(302, `${loginUrl.toString()}?error=sso_account_unavailable`);
      return;
    }
    if (!user) {
      const emailAccount = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true, role: true, emailVerifiedAt: true, disabledAt: true },
      });
      if (!emailAccount || emailAccount.disabledAt) {
        response.redirect(302, `${loginUrl.toString()}?error=sso_account_unavailable`);
        return;
      }
      await prisma.$transaction(async (transaction) => {
        await transaction.externalIdentity.create({
          data: {
            issuer: claims.iss!,
            subject: claims.sub!,
            userId: emailAccount.id,
          },
        });
        if (!emailAccount.emailVerifiedAt) {
          await transaction.user.update({
            where: { id: emailAccount.id },
            data: { emailVerifiedAt: new Date() },
          });
        }
        if (typeof claims.name === "string" && claims.name.trim()) {
          await transaction.user.update({
            where: { id: emailAccount.id },
            data: { name: claims.name.trim().slice(0, 120) },
          });
        }
      });
      user = {
        ...emailAccount,
        name: typeof claims.name === "string" && claims.name.trim()
          ? claims.name.trim().slice(0, 120)
          : emailAccount.name,
      };
    }

    await prisma.loginAttempt.create({
      data: { email: user.email, userId: user.id, success: true, reason: "OIDC" },
    });
    setSessionCookie(response, await createSessionToken(user, request));
    response.redirect(302, new URL(loginRequest.returnTo, config.WEB_ORIGIN).toString());
  }),
);

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
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(input.newPassword, 12) },
      }),
      prisma.userSession.updateMany({
        where: {
          userId: user.id,
          id: { not: response.locals.sessionId as string },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
    ]);
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
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          role: "EVENT_MANAGER",
          organization: {
            create: {
              name: `${input.name}'s organization`,
              slug: `personal-${randomBytes(8).toString("hex")}`,
            },
          },
        },
        select: { id: true, name: true, email: true, role: true, organizationId: true },
      });
      await transaction.organizationMembership.create({
        data: {
          userId: created.id,
          organizationId: created.organizationId!,
          role: "OWNER",
        },
      });
      return created;
    });
    setSessionCookie(response, await createSessionToken(user, request));
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
      await prisma.loginAttempt.create({
        data: {
          email: credentials.email,
          userId: user?.id,
          success: false,
          userAgent: request.get("user-agent")?.slice(0, 1000),
          reason: "INVALID_CREDENTIALS",
        },
      });
      response.status(401).json({ error: "Email or password is incorrect" });
      return;
    }
    if (user.disabledAt) {
      await prisma.loginAttempt.create({
        data: {
          email: credentials.email,
          userId: user.id,
          success: false,
          userAgent: request.get("user-agent")?.slice(0, 1000),
          reason: "ACCOUNT_DISABLED",
        },
      });
      response.status(403).json({ error: "This account is disabled. Contact platform support." });
      return;
    }
    const twoFactor = await prisma.twoFactorCredential.findUnique({ where: { userId: user.id } });
    if (twoFactor?.enabled) {
      const twoFactorCode = credentials.code?.trim().toUpperCase();
      const totpValid = twoFactorCode
        ? verifyTotp(decryptText(twoFactor.secret, totpEncryptionKey), twoFactorCode)
        : false;
      const hashedBackupCode = twoFactorCode ? hashOpaqueToken(twoFactorCode) : "";
      const backupIndex = twoFactorCode
        ? twoFactor.backupCodes.findIndex((value) => value === hashedBackupCode || value === twoFactorCode)
        : -1;
      if (!totpValid && backupIndex < 0) {
        await prisma.loginAttempt.create({
          data: {
            email: credentials.email,
            userId: user.id,
            success: false,
            userAgent: request.get("user-agent")?.slice(0, 1000),
            reason: "INVALID_MFA",
          },
        });
        response.status(401).json({ error: "A valid two-factor authentication code is required", mfaRequired: true });
        return;
      }
      const remaining = twoFactor.backupCodes.map((value) =>
        /^[0-9a-f]{64}$/.test(value) ? value : hashOpaqueToken(value),
      );
      if (backupIndex >= 0) {
        remaining.splice(backupIndex, 1);
      }
      if (backupIndex >= 0 || !twoFactor.secret.startsWith("enc:v1:") ||
          remaining.some((value, index) => value !== twoFactor.backupCodes[index])) {
        await prisma.twoFactorCredential.update({
          where: { userId: user.id },
          data: {
            secret: encryptText(decryptText(twoFactor.secret, totpEncryptionKey), totpEncryptionKey),
            backupCodes: remaining,
          },
        });
      }
    }

    await prisma.loginAttempt.create({
      data: {
        email: credentials.email,
        userId: user.id,
        success: true,
        userAgent: request.get("user-agent")?.slice(0, 1000),
      },
    });
    setSessionCookie(response, await createSessionToken(user, request));
    response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mfaEnabled: Boolean(twoFactor?.enabled),
      },
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
    const existing = await prisma.twoFactorCredential.findUnique({
      where: { userId: authUser.id },
      select: { enabled: true },
    });
    if (existing?.enabled) {
      response.status(409).json({ error: "Two-factor authentication is already enabled" });
      return;
    }
    const account = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { email: true },
    });
    if (!account) {
      response.status(401).json({ error: "Account is no longer available" });
      return;
    }
    const secret = createBase32Secret();
    const backupCodes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex").slice(0, 10).toUpperCase());
    const issuer = "EventFlow";
    const label = encodeURIComponent(`${issuer}:${account.email}`);
    const authenticatorUri = `otpauth://totp/${label}?${new URLSearchParams({
      secret,
      issuer,
      algorithm: "SHA1",
      digits: "6",
      period: "30",
    })}`;
    const qrCodeDataUrl = await QRCode.toDataURL(authenticatorUri, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
    });
    await prisma.twoFactorCredential.upsert({
      where: { userId: authUser.id },
      create: {
        userId: authUser.id,
        secret: encryptText(secret, totpEncryptionKey),
        backupCodes: backupCodes.map(hashOpaqueToken),
      },
      update: {
        secret: encryptText(secret, totpEncryptionKey),
        enabled: false,
        verifiedAt: null,
        backupCodes: backupCodes.map(hashOpaqueToken),
      },
    });
    response.json({ secret, backupCodes, qrCodeDataUrl });
  }),
);

authRouter.post(
  "/2fa/verify",
  requireAuth,
  asyncHandler(async (request, response) => {
    const authUser = (request as AuthenticatedRequest).user!;
    const input = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const credential = await prisma.twoFactorCredential.findUnique({ where: { userId: authUser.id } });
    if (!credential || !verifyTotp(decryptText(credential.secret, totpEncryptionKey), input.code)) {
      response.status(400).json({ error: "Invalid authentication code" });
      return;
    }
    await prisma.$transaction([
      prisma.twoFactorCredential.update({
        where: { userId: authUser.id },
        data: { enabled: true, verifiedAt: new Date() },
      }),
      prisma.userSession.updateMany({
        where: {
          userId: authUser.id,
          id: { not: response.locals.sessionId as string },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
    ]);
    response.json({ enabled: true });
  }),
);

authRouter.post(
  "/2fa/disable",
  requireAuth,
  asyncHandler(async (request, response) => {
    const authUser = (request as AuthenticatedRequest).user!;
    if (authUser.role === "ADMIN") {
      response.status(403).json({ error: "Platform administrators must keep two-factor authentication enabled" });
      return;
    }
    const input = z.object({
      password: z.string().min(1).max(200),
    }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      response.status(400).json({ error: "Password is incorrect" });
      return;
    }
    await prisma.$transaction([
      prisma.twoFactorCredential.deleteMany({ where: { userId: authUser.id } }),
      prisma.userSession.updateMany({
        where: {
          userId: authUser.id,
          id: { not: response.locals.sessionId as string },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
    ]);
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
        purpose: PasswordResetPurpose.PASSWORD_RESET,
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
      prisma.userSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    response.json({ reset: true });
  }),
);

authRouter.post(
  "/accept-admin-invite",
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
        purpose: "ADMIN_INVITE",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true },
    });
    if (!record) {
      response.status(400).json({ error: "Invitation link is invalid or expired" });
      return;
    }
    const accepted = await prisma.$transaction(async (transaction) => {
      const accepted = await transaction.passwordResetToken.updateMany({
        where: {
          id: record.id,
          purpose: "ADMIN_INVITE",
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (accepted.count !== 1) return false;
      await transaction.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: await bcrypt.hash(input.password, 12),
          emailVerifiedAt: new Date(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: record.userId,
          action: "ACCEPT_PLATFORM_INVITATION",
          entityType: "user",
          entityId: record.userId,
        },
      });
      return true;
    });
    if (!accepted) {
      response.status(400).json({ error: "Invitation link is invalid or expired" });
      return;
    }
    response.json({ accepted: true });
  }),
);

authRouter.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (request, response) => {
    const user = (request as AuthenticatedRequest).user!;
    const sessions = await prisma.userSession.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        device: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: "desc" },
    });
    response.json({
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === response.locals.sessionId,
      })),
    });
  }),
);

authRouter.delete(
  "/sessions/:sessionId",
  requireAuth,
  asyncHandler(async (request, response) => {
    const user = (request as AuthenticatedRequest).user!;
    const sessionId = z.string().uuid().parse(request.params.sessionId);
    const revoked = await prisma.userSession.updateMany({
      where: { id: sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      response.status(404).json({ error: "Session not found" });
      return;
    }
    if (sessionId === response.locals.sessionId) clearSessionCookie(response);
    response.status(204).end();
  }),
);

authRouter.post(
  "/sessions/revoke-others",
  requireAuth,
  asyncHandler(async (request, response) => {
    const user = (request as AuthenticatedRequest).user!;
    const currentSessionId = response.locals.sessionId as string;
    const result = await prisma.userSession.updateMany({
      where: { userId: user.id, id: { not: currentSessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    response.json({ revoked: result.count });
  }),
);

authRouter.post("/logout", asyncHandler(async (request, response) => {
  await revokeSessionToken(request.cookies?.eventflow_session);
  clearSessionCookie(response);
  response.status(204).end();
}));

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
    response.json({
      user: {
        ...user,
        mfaEnabled: (request as AuthenticatedRequest).user!.mfaEnabled,
      },
    });
  }),
);

authRouter.get(
  "/data-export",
  requireAuth,
  asyncHandler(async (request, response) => {
    const userId = (request as AuthenticatedRequest).user!.id;
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        organizationMemberships: {
          select: {
            role: true,
            createdAt: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
        memberships: {
          select: {
            role: true,
            createdAt: true,
            event: {
              select: {
                id: true,
                title: true,
                type: true,
                startDate: true,
                endDate: true,
                location: true,
              },
            },
          },
        },
        consents: {
          select: {
            subjectType: true,
            subjectId: true,
            documentType: true,
            version: true,
            acceptedAt: true,
          },
          orderBy: { acceptedAt: "desc" },
        },
        sessions: {
          select: {
            device: true,
            createdAt: true,
            lastUsedAt: true,
            expiresAt: true,
            revokedAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
        loginAttempts: {
          select: {
            email: true,
            success: true,
            reason: true,
            userAgent: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 500,
        },
        auditLogs: {
          select: {
            action: true,
            entityType: true,
            entityId: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 500,
        },
      },
    });
    if (!account) {
      response.status(404).json({ error: "Account is no longer available" });
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="eventflow-account-data-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    response.json({ exportedAt: new Date().toISOString(), account });
  }),
);
