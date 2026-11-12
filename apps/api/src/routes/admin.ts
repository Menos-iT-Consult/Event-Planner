import { Router } from "express";
import { Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { moneySchema } from "../lib/money.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";

const settingSchema = z.object({
  value: moneySchema(),
  description: z.string().trim().max(300).optional(),
});

const userSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(200),
  role: z.enum(["ADMIN", "EVENT_MANAGER", "CHECK_IN_STAFF"]),
});

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

async function writeAudit(
  actorId: string,
  action: string,
  entityType: string,
  entityId?: string,
  metadata?: object,
) {
  await prisma.auditLog.create({
    data: { actorId, action, entityType, entityId, metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined },
  });
}

adminRouter.get(
  "/settings",
  asyncHandler(async (_request, response) => {
    const settings = await prisma.platformSetting.findMany({
      orderBy: { key: "asc" },
    });
    response.json({ settings });
  }),
);

adminRouter.put(
  "/settings/:key",
  asyncHandler(async (request, response) => {
    const { key } = z
      .object({ key: z.enum(["WEDDING_DAILY_RATE", "VOTING_DAILY_RATE", "GENERAL_DAILY_RATE"]) })
      .parse(request.params);
    const input = settingSchema.parse(request.body);
    const setting = await prisma.platformSetting.upsert({
      where: { key },
      create: {
        key,
        value: new Prisma.Decimal(input.value),
        description: input.description ?? `Daily rate for ${key.replace("_DAILY_RATE", "").toLowerCase()} events`,
      },
      update: {
        value: new Prisma.Decimal(input.value),
        description: input.description,
      },
    });
    response.json({ setting });
  }),
);

adminRouter.post(
  "/users",
  asyncHandler(async (request, response) => {
    const input = userSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        role: input.role,
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    response.status(201).json({ user });
  }),
);

adminRouter.get(
  "/overview",
  asyncHandler(async (_request, response) => {
    const [events, guests, votes, paidOrders, contactMessages, staff] = await Promise.all([
      prisma.event.count(),
      prisma.guest.count(),
      prisma.vote.count(),
      prisma.ticketOrder.count({ where: { status: "PAID" } }),
      prisma.contactMessage.count({ where: { handled: false } }),
      prisma.user.count(),
    ]);
    const byType = await prisma.event.groupBy({ by: ["type"], _count: { _all: true } });
    const revenueRows = await prisma.ticketOrder.findMany({
      where: { status: "PAID" },
      select: { amount: true },
    });
    const voteRevenueRows = await prisma.votePurchase.findMany({
      where: { status: "PAID" },
      select: { amount: true },
    });
    const revenue = [...revenueRows, ...voteRevenueRows].reduce(
      (sum, row) => sum.plus(row.amount),
      new Prisma.Decimal(0),
    );
    response.json({ events, guests, votes, paidOrders, contactMessages, staff, byType, revenue: revenue.toFixed(2) });
  }),
);

adminRouter.get("/users", asyncHandler(async (_request, response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, emailVerifiedAt: true,
      organization: { select: { id: true, name: true } },
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  response.json({ users });
}));

adminRouter.post("/users/:userId/reset-password", asyncHandler(async (request, response) => {
  const userId = z.string().uuid().parse(request.params.userId);
  const input = z.object({ password: z.string().min(12).max(200) }).parse(request.body);
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!target) {
    response.status(404).json({ error: "User account not found" });
    return;
  }
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: await bcrypt.hash(input.password, 12) },
  });
  await prisma.passwordResetToken.updateMany({
    where: { userId: target.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  await writeAudit((request as AuthenticatedRequest).user!.id, "RESET_PASSWORD", "user", target.id, { email: target.email });
  response.json({ reset: true, email: target.email });
}));

adminRouter.get("/contact", asyncHandler(async (request, response) => {
  const handled = request.query.handled === "true";
  const messages = await prisma.contactMessage.findMany({
    where: request.query.handled === undefined ? undefined : { handled },
    orderBy: { createdAt: "desc" },
  });
  response.json({ messages });
}));

adminRouter.patch("/contact/:messageId", asyncHandler(async (request, response) => {
  const input = z.object({ handled: z.boolean() }).parse(request.body);
  const message = await prisma.contactMessage.update({
    where: { id: z.string().uuid().parse(request.params.messageId) },
    data: input,
  });
  await writeAudit((request as AuthenticatedRequest).user!.id, "UPDATE_CONTACT", "contact", message.id, input);
  response.json({ message });
}));

adminRouter.get("/templates", asyncHandler(async (_request, response) => {
  const templates = await prisma.notificationTemplate.findMany({ orderBy: { key: "asc" } });
  response.json({ templates });
}));

adminRouter.put("/templates/:key", asyncHandler(async (request, response) => {
  const key = z.string().trim().min(1).max(100).parse(request.params.key);
  const input = z.object({
    subject: z.string().trim().max(200).optional(),
    message: z.string().trim().min(1).max(2000),
    channel: z.enum(["SMS", "EMAIL"]).default("SMS"),
    enabled: z.boolean().default(true),
  }).parse(request.body);
  const template = await prisma.notificationTemplate.upsert({
    where: { key },
    create: { key, ...input },
    update: input,
  });
  await writeAudit((request as AuthenticatedRequest).user!.id, "UPDATE_TEMPLATE", "notification_template", template.id, { key });
  response.json({ template });
}));

adminRouter.get("/audit", asyncHandler(async (_request, response) => {
  const logs = await prisma.auditLog.findMany({
    take: 100,
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });
  response.json({ logs });
}));

adminRouter.get("/organizations", asyncHandler(async (_request, response) => {
  const organizations = await prisma.organization.findMany({
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });
  response.json({ organizations });
}));

adminRouter.post("/organizations", asyncHandler(async (request, response) => {
  const input = z.object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(2000).optional(),
    website: z.string().url().optional(),
  }).parse(request.body);
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const organization = await prisma.organization.create({
    data: { ...input, slug },
  });
  await writeAudit((request as AuthenticatedRequest).user!.id, "CREATE_ORGANIZATION", "organization", organization.id);
  response.json({ organization });
}));

adminRouter.post("/users/:userId/verify-email", asyncHandler(async (request, response) => {
  const userId = z.string().uuid().parse(request.params.userId);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  await writeAudit((request as AuthenticatedRequest).user!.id, "VERIFY_EMAIL", "user", user.id);
  response.json({ user });
}));
