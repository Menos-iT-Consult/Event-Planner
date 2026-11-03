import { Router } from "express";
import { Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { moneySchema } from "../lib/money.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

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
    const [events, guests, votes, paidOrders] = await Promise.all([
      prisma.event.count(),
      prisma.guest.count(),
      prisma.vote.count(),
      prisma.ticketOrder.count({ where: { status: "PAID" } }),
    ]);
    response.json({ events, guests, votes, paidOrders });
  }),
);
