import { Router } from "express";
import { EventType, OrganizationRole, PasswordResetPurpose, Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { moneySchema } from "../lib/money.js";
import { createOpaqueToken, hashOpaqueToken } from "../lib/tokens.js";
import { requireAdminMfa, requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";

const settingSchema = z.object({
  value: moneySchema(),
  description: z.string().trim().max(300).optional(),
});

const inviteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().transform((email) => email.toLowerCase()),
  role: z.enum(["EVENT_MANAGER", "CHECK_IN_STAFF"]),
});

const subscriptionPlanSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  price: moneySchema(),
  currency: z.literal("GHS").default("GHS"),
  interval: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  features: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  maxEvents: z.number().int().positive().nullable().optional(),
  maxMembers: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});

class LastActiveAdminError extends Error {}

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole(UserRole.ADMIN), requireAdminMfa);

adminRouter.get("/subscription-plans", asyncHandler(async (_request, response) => {
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: [{ active: "desc" }, { price: "asc" }, { name: "asc" }],
  });
  response.json({
    plans: plans.map((plan) => ({
      ...plan,
      features: Array.isArray(plan.features)
        ? plan.features.filter((feature): feature is string => typeof feature === "string")
        : [],
    })),
  });
}));

adminRouter.post("/subscription-plans", asyncHandler(async (request, response) => {
  const input = subscriptionPlanSchema.parse(request.body);
  const plan = await prisma.subscriptionPlan.create({
    data: {
      ...input,
      price: new Prisma.Decimal(input.price),
      features: input.features,
    },
  });
  await writeAudit((request as AuthenticatedRequest).user!.id, "CREATE_SUBSCRIPTION_PLAN", "subscription_plan", plan.id);
  response.status(201).json({ plan });
}));

adminRouter.put("/subscription-plans/:planId", asyncHandler(async (request, response) => {
  const planId = z.string().uuid().parse(request.params.planId);
  const input = subscriptionPlanSchema.parse(request.body);
  const plan = await prisma.subscriptionPlan.update({
    where: { id: planId },
    data: {
      ...input,
      price: new Prisma.Decimal(input.price),
      features: input.features,
    },
  });
  await writeAudit((request as AuthenticatedRequest).user!.id, "UPDATE_SUBSCRIPTION_PLAN", "subscription_plan", plan.id);
  response.json({ plan });
}));

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
    const setting = await prisma.$transaction(async (transaction) => {
      const previous = await transaction.platformSetting.findUnique({ where: { key } });
      const updated = await transaction.platformSetting.upsert({
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
      await transaction.auditLog.create({
        data: {
          actorId: (request as AuthenticatedRequest).user!.id,
          action: "UPDATE_PLATFORM_SETTING",
          entityType: "platform_setting",
          entityId: key,
          metadata: {
            previousValue: previous?.value.toString() ?? null,
            value: updated.value.toString(),
          },
        },
      });
      return updated;
    });
    response.json({ setting });
  }),
);

adminRouter.post(
  "/users/invite",
  asyncHandler(async (request, response) => {
    const input = inviteSchema.parse(request.body);
    if (!config.SMTP_HOST) {
      response.status(503).json({ error: "Email delivery is not configured; invitations are unavailable" });
      return;
    }
    if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
      response.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    const token = createOpaqueToken();
    let user;
    try {
      user = await prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash: await bcrypt.hash(createOpaqueToken(), 12),
            role: input.role,
          },
          select: { id: true, email: true, name: true, role: true, createdAt: true },
        });
        await transaction.passwordResetToken.create({
          data: {
            userId: created.id,
            tokenHash: hashOpaqueToken(token),
            purpose: PasswordResetPurpose.ADMIN_INVITE,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        await transaction.backgroundJob.create({
          data: {
            type: "SEND_EMAIL",
            payload: {
              to: created.email,
              subject: "You are invited to EventFlow",
              text: `Hello ${created.name},\n\nYou have been invited to join EventFlow as a ${created.role.replaceAll("_", " ").toLowerCase()}.\nSet your password and accept the invitation here:\n${config.WEB_ORIGIN}/reset-password?invite=1&token=${encodeURIComponent(token)}\n\nThis link expires in 24 hours. If you did not expect this invitation, you can ignore this email.`,
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: (request as AuthenticatedRequest).user!.id,
            action: "INVITE_PLATFORM_USER",
            entityType: "user",
            entityId: created.id,
            metadata: { email: created.email, role: created.role },
          },
        });
        return created;
      });
    } catch (reason) {
      if (reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === "P2002") {
        response.status(409).json({ error: "An account with this email already exists" });
        return;
      }
      throw reason;
    }
    response.status(201).json({ user, delivery: "QUEUED" });
  }),
);

adminRouter.get(
  "/overview",
  asyncHandler(async (request, response) => {
    const { days } = z.object({
      days: z.coerce.number().int().refine((value) => [7, 30, 90].includes(value), "Choose 7, 30, or 90 days").default(30),
    }).parse(request.query);
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const previousSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);
    const upcomingLimit = new Date(startOfToday.getTime() + days * 24 * 60 * 60 * 1000);
    const [activeEvents, upcomingEvents, newEvents, previousEvents, newAccounts, previousAccounts, paidTicketOrders, paidVotePurchases, paidInvoices, completedRefunds, openContacts, failedJobs, pendingPrivacy, eventsByType, recentActivity] = await Promise.all([
      prisma.event.count({ where: { startDate: { lte: endOfToday }, endDate: { gte: startOfToday } } }),
      prisma.event.count({ where: { startDate: { gt: endOfToday, lte: upcomingLimit } } }),
      prisma.event.count({ where: { createdAt: { gte: since, lte: now } } }),
      prisma.event.count({ where: { createdAt: { gte: previousSince, lt: since } } }),
      prisma.user.count({ where: { createdAt: { gte: since, lte: now }, disabledAt: null } }),
      prisma.user.count({ where: { createdAt: { gte: previousSince, lt: since }, disabledAt: null } }),
      prisma.ticketOrder.groupBy({
        by: ["currency"],
        where: { status: "PAID", paidAt: { gte: since, lte: now } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.votePurchase.groupBy({
        by: ["currency"],
        where: { status: "PAID", paidAt: { gte: since, lte: now } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.subscriptionInvoice.groupBy({
        by: ["currency"],
        where: { status: "PAID", paidAt: { gte: since, lte: now } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.refund.groupBy({
        by: ["currency"],
        where: { status: "COMPLETED", resolvedAt: { gte: since, lte: now } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.contactMessage.count({ where: { handled: false } }),
      prisma.backgroundJob.count({ where: { status: { in: ["FAILED", "DEAD"] } } }),
      prisma.dataDeletionRequest.count({ where: { completedAt: null } }),
      prisma.event.groupBy({
        by: ["type"],
        where: { createdAt: { gte: since, lte: now } },
        _count: { _all: true },
      }),
      prisma.auditLog.findMany({
        take: 5,
        include: { actor: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    type RevenueSummary = {
      tickets: Prisma.Decimal;
      votes: Prisma.Decimal;
      subscriptions: Prisma.Decimal;
      refunds: Prisma.Decimal;
      paidOrders: number;
    };
    const revenue = new Map<string, RevenueSummary>();
    for (const [kind, rows] of [
      ["tickets", paidTicketOrders],
      ["votes", paidVotePurchases],
      ["subscriptions", paidInvoices],
      ["refunds", completedRefunds],
    ] as const) {
      for (const row of rows) {
        const totals = revenue.get(row.currency) ?? {
          tickets: new Prisma.Decimal(0),
          votes: new Prisma.Decimal(0),
          subscriptions: new Prisma.Decimal(0),
          refunds: new Prisma.Decimal(0),
          paidOrders: 0,
        };
        const amount = row._sum.amount ?? new Prisma.Decimal(0);
        if (kind === "tickets") {
          totals.tickets = totals.tickets.plus(amount);
          totals.paidOrders += row._count._all;
        } else if (kind === "votes") {
          totals.votes = totals.votes.plus(amount);
          totals.paidOrders += row._count._all;
        } else if (kind === "subscriptions") {
          totals.subscriptions = totals.subscriptions.plus(amount);
          totals.paidOrders += row._count._all;
        } else {
          totals.refunds = totals.refunds.plus(amount);
        }
        revenue.set(row.currency, totals);
      }
    }
    response.json({
      days,
      since,
      activeEvents,
      upcomingEvents,
      newEvents,
      previousEvents,
      newAccounts,
      previousAccounts,
      eventsByType,
      recentActivity,
      revenueByCurrency: Array.from(revenue, ([currency, totals]) => ({
        currency,
        tickets: totals.tickets.toFixed(2),
        votes: totals.votes.toFixed(2),
        subscriptions: totals.subscriptions.toFixed(2),
        refunds: totals.refunds.toFixed(2),
        paidOrders: totals.paidOrders,
        net: totals.tickets.plus(totals.votes).plus(totals.subscriptions).minus(totals.refunds).toFixed(2),
      })),
      queues: { openContacts, failedJobs, pendingPrivacy },
    });
  }),
);

adminRouter.get("/events", asyncHandler(async (request, response) => {
  const input = z.object({
    q: z.string().trim().max(120).optional(),
    type: z.nativeEnum(EventType).optional(),
    status: z.enum(["all", "active", "upcoming", "past", "published", "unpublished"]).default("all"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  }).parse(request.query);
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);
  const where: Prisma.EventWhereInput = {
    ...(input.type ? { type: input.type } : {}),
    ...(input.q ? {
      OR: [
        { title: { contains: input.q, mode: "insensitive" } },
        { slug: { contains: input.q, mode: "insensitive" } },
        { organization: { name: { contains: input.q, mode: "insensitive" } } },
      ],
    } : {}),
  };
  if (input.status === "active") {
    where.startDate = { lte: endOfToday };
    where.endDate = { gte: startOfToday };
  } else if (input.status === "upcoming") {
    where.startDate = { gt: endOfToday };
  } else if (input.status === "past") {
    where.endDate = { lt: startOfToday };
  } else if (input.status === "published") {
    where.isPublished = true;
  } else if (input.status === "unpublished") {
    where.isPublished = false;
  }
  const [total, events] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: {
        id: true,
        slug: true,
        title: true,
        type: true,
        startDate: true,
        endDate: true,
        currency: true,
        isPublished: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
        _count: { select: { guests: true, orders: true } },
      },
    }),
  ]);
  response.json({ events, total, page: input.page, limit: input.limit, pageCount: Math.ceil(total / input.limit) });
}));

adminRouter.get("/users", asyncHandler(async (request, response) => {
  const input = z.object({
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(request.query);
  const where: Prisma.UserWhereInput = input.q ? {
    OR: [
      { name: { contains: input.q, mode: "insensitive" } },
      { email: { contains: input.q, mode: "insensitive" } },
    ],
  } : {};
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: {
        id: true, name: true, email: true, role: true, emailVerifiedAt: true,
        disabledAt: true, disabledReason: true,
        twoFactor: { select: { enabled: true } },
        organization: { select: { id: true, name: true } },
        organizationMemberships: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { organization: { select: { id: true, name: true } } },
        },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  response.json({
    users: users.map(({ organization, organizationMemberships, twoFactor, ...user }) => ({
      ...user,
      mfaEnabled: Boolean(twoFactor?.enabled),
      organization: organization ?? organizationMemberships[0]?.organization ?? null,
    })),
    total,
    page: input.page,
    limit: input.limit,
    pageCount: Math.ceil(total / input.limit),
  });
}));

adminRouter.post("/users/:userId/password-reset", asyncHandler(async (request, response) => {
  if (!config.SMTP_HOST) {
    response.status(503).json({ error: "Email delivery is not configured; password reset emails are unavailable" });
    return;
  }
  const userId = z.string().uuid().parse(request.params.userId);
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!target) {
    response.status(404).json({ error: "User account not found" });
    return;
  }
  const token = createOpaqueToken();
  await prisma.$transaction(async (transaction) => {
    await transaction.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await transaction.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(token),
        purpose: PasswordResetPurpose.PASSWORD_RESET,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await transaction.backgroundJob.create({
      data: {
        type: "SEND_EMAIL",
        payload: {
          to: target.email,
          subject: "Reset your EventFlow password",
          text: `An administrator requested a password reset for your EventFlow account.\nSet a new password here:\n${config.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}\n\nThis link expires in 60 minutes. If you did not expect this email, contact your organization administrator.`,
        },
      },
    });
    await transaction.auditLog.create({
      data: {
        actorId: (request as AuthenticatedRequest).user!.id,
        action: "REQUEST_USER_PASSWORD_RESET",
        entityType: "user",
        entityId: userId,
        metadata: { email: target.email },
      },
    });
  });
  response.json({ delivery: "QUEUED", email: target.email });
}));

adminRouter.patch("/users/:userId/status", asyncHandler(async (request, response) => {
  const userId = z.string().uuid().parse(request.params.userId);
  const input = z.object({
    disabled: z.boolean(),
    reason: z.string().trim().max(300).optional(),
  }).parse(request.body);
  const actorId = (request as AuthenticatedRequest).user!.id;
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, disabledAt: true },
  });
  if (!target) {
    response.status(404).json({ error: "User account not found" });
    return;
  }
  if (input.disabled && target.id === actorId) {
    response.status(400).json({ error: "You cannot disable your own account" });
    return;
  }
  try {
    const updated = await prisma.$transaction(async (transaction) => {
      if (input.disabled && target.role === UserRole.ADMIN && !target.disabledAt) {
        const activeAdmins = await transaction.user.count({
          where: { role: UserRole.ADMIN, disabledAt: null, id: { not: target.id } },
        });
        if (activeAdmins === 0) throw new LastActiveAdminError();
      }
      const disabledAt = input.disabled ? target.disabledAt ?? new Date() : null;
      const user = await transaction.user.update({
        where: { id: userId },
        data: { disabledAt, disabledReason: input.disabled ? input.reason || null : null },
        select: { id: true, email: true, role: true, disabledAt: true, disabledReason: true },
      });
      if (input.disabled) {
        await transaction.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId,
          action: input.disabled ? "DISABLE_USER" : "ENABLE_USER",
          entityType: "user",
          entityId: userId,
          metadata: { email: target.email, reason: input.disabled ? input.reason ?? null : null },
        },
      });
      return user;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    response.json({ user: updated });
  } catch (reason) {
    if (reason instanceof LastActiveAdminError) {
      response.status(409).json({ error: "The last active platform administrator cannot be disabled" });
      return;
    }
    if (reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === "P2034") {
      response.status(409).json({ error: "Account status changed concurrently; refresh and try again" });
      return;
    }
    throw reason;
  }
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

adminRouter.get("/audit", asyncHandler(async (request, response) => {
  const input = z.object({
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(request.query);
  const where: Prisma.AuditLogWhereInput = input.q ? {
    OR: [
      { action: { contains: input.q, mode: "insensitive" } },
      { entityType: { contains: input.q, mode: "insensitive" } },
      { entityId: { contains: input.q, mode: "insensitive" } },
      { actor: { is: { name: { contains: input.q, mode: "insensitive" } } } },
      { actor: { is: { email: { contains: input.q, mode: "insensitive" } } } },
    ],
  } : {};
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  response.json({ logs, total, page: input.page, limit: input.limit, pageCount: Math.ceil(total / input.limit) });
}));

adminRouter.get("/organizations", asyncHandler(async (_request, response) => {
  const organizations = await prisma.organization.findMany({
    include: {
      _count: { select: { memberships: true, events: true } },
      memberships: {
        where: { role: OrganizationRole.OWNER },
        take: 1,
        select: { user: { select: { id: true, name: true, email: true } } },
      },
      subscriptions: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          status: true,
          currentPeriodEnd: true,
          plan: { select: { name: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  response.json({
    organizations: organizations.map(({ memberships, subscriptions, ...organization }) => ({
      ...organization,
      owner: memberships[0]?.user ?? null,
      subscription: subscriptions[0] ?? null,
    })),
  });
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
