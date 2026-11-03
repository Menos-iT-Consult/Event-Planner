import { Router } from "express";
import { EventType, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { inclusiveCalendarDays, parseDateOnly } from "../lib/duration.js";
import { createOpaqueToken, hashOpaqueToken } from "../lib/tokens.js";
import { moneySchema } from "../lib/money.js";
import { phoneNumberSchema } from "../lib/contact.js";
import { getRouteParam } from "../lib/route-param.js";
import {
  requireAuth,
  requireEventAccess,
  requireEventStaffAccess,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { sendEventSms } from "../services/messaging.js";
import { createAssetUpload } from "../services/storage.js";

const createEventSchema = z.object({
  title: z.string().trim().min(2).max(160),
  type: z.nativeEnum(EventType),
  startDate: z.string().refine(isValidDateOnly, "Date must be a valid YYYY-MM-DD date"),
  endDate: z.string().refine(isValidDateOnly, "Date must be a valid YYYY-MM-DD date"),
  location: z.string().trim().min(2).max(240),
  description: z.string().trim().max(5000).optional(),
  currency: z.literal("GHS").default("GHS"),
  voteUnitPrice: moneySchema(0.01, 1_000_000).optional(),
}).refine((event) => event.endDate >= event.startDate, {
  message: "endDate must be on or after startDate",
  path: ["endDate"],
});

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const guestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: phoneNumberSchema,
  email: z.string().email().optional(),
  plusOnes: z.number().int().min(0).max(20).default(0),
  dietary: z.string().trim().max(500).optional(),
});

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const candidateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  photoKey: z.string().optional(),
});

const tierSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  price: moneySchema(0.01, 1_000_000),
  quantity: z.number().int().positive().max(1_000_000),
});

const sessionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(240).optional(),
  speaker: z.string().trim().max(160).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
}).refine((session) => new Date(session.endsAt) > new Date(session.startsAt), {
  message: "endsAt must be later than startsAt",
  path: ["endsAt"],
});

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

eventsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = (request as AuthenticatedRequest).user!;
    const events = await prisma.event.findMany({
      where: user.role === UserRole.ADMIN
        ? undefined
        : { memberships: { some: { userId: user.id } } },
      orderBy: { startDate: "asc" },
      select: {
        id: true,
        slug: true,
        title: true,
        type: true,
        startDate: true,
        endDate: true,
        durationDays: true,
        totalCost: true,
        currency: true,
        location: true,
      },
    });
    response.json({ events });
  }),
);

eventsRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = createEventSchema.parse(request.body);
    const durationDays = inclusiveCalendarDays(input.startDate, input.endDate);
    const startDate = parseDateOnly(input.startDate);
    const endDate = parseDateOnly(input.endDate);
    const settingKey = `${input.type}_DAILY_RATE`;
    const setting = await prisma.platformSetting.findUnique({ where: { key: settingKey } });
    if (!setting) {
      response.status(503).json({ error: `Pricing setting ${settingKey} is not configured` });
      return;
    }
    const totalCost = setting.value.mul(durationDays);
    if (totalCost.greaterThan("9999999999.99")) {
      response.status(400).json({ error: "The event duration and daily rate exceed the supported price range" });
      return;
    }

    const user = (request as AuthenticatedRequest).user!;
    const event = await prisma.event.create({
      data: {
        slug: `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}-${createOpaqueToken().slice(0, 6)}`,
        title: input.title,
        type: input.type,
        startDate,
        endDate,
        durationDays,
        dailyRate: setting.value,
        totalCost,
        voteUnitPrice: input.type === EventType.VOTING && input.voteUnitPrice !== undefined
          ? new Prisma.Decimal(input.voteUnitPrice)
          : undefined,
        currency: input.currency,
        location: input.location,
        description: input.description,
        memberships: user.role === UserRole.ADMIN
          ? undefined
          : {
              create: {
                userId: user.id,
                role: UserRole.EVENT_MANAGER,
              },
            },
      },
    });
    response.status(201).json({ event });
  }),
);

eventsRouter.get(
  "/:eventId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await prisma.event.findUnique({
      where: { id: getRouteParam(request, "eventId") },
      include: {
        _count: { select: { guests: true, categories: true, orders: true } },
      },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    response.json({ event });
  }),
);

eventsRouter.post(
  "/:eventId/staff",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const user = (request as AuthenticatedRequest).user!;
    if (user.role !== UserRole.ADMIN) {
      const currentMembership = await prisma.eventMembership.findUnique({
        where: { userId_eventId: { userId: user.id, eventId: getRouteParam(request, "eventId") } },
      });
      if (currentMembership?.role !== UserRole.EVENT_MANAGER) {
        response.status(403).json({ error: "Only an event manager can assign event staff" });
        return;
      }
    }

    const input = z.object({
      email: z.string().email().transform((email) => email.toLowerCase()),
      role: z.enum(["EVENT_MANAGER", "CHECK_IN_STAFF"]),
    }).parse(request.body);
    const target = await prisma.user.findUnique({ where: { email: input.email } });
    if (!target) {
      response.status(404).json({ error: "User account not found; ask an administrator to create it" });
      return;
    }
    const membership = await prisma.eventMembership.upsert({
      where: {
        userId_eventId: { userId: target.id, eventId: getRouteParam(request, "eventId") },
      },
      create: {
        userId: target.id,
        eventId: getRouteParam(request, "eventId"),
        role: input.role,
      },
      update: { role: input.role },
      select: { id: true, userId: true, eventId: true, role: true, createdAt: true },
    });
    response.status(201).json({ membership });
  }),
);

eventsRouter.get(
  "/:eventId/staff",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const memberships = await prisma.eventMembership.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      select: {
        userId: true,
        role: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    response.json({ staff: memberships });
  }),
);

eventsRouter.delete(
  "/:eventId/staff/:userId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const currentUser = (request as AuthenticatedRequest).user!;
    const userId = getRouteParam(request, "userId");
    const eventId = getRouteParam(request, "eventId");
    if (userId === currentUser.id) {
      response.status(400).json({ error: "You cannot remove your own event access" });
      return;
    }
    const membership = await prisma.eventMembership.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });
    if (!membership) {
      response.status(404).json({ error: "Event staff member not found" });
      return;
    }
    await prisma.eventMembership.delete({
      where: { userId_eventId: { userId, eventId } },
    });
    response.status(204).end();
  }),
);

eventsRouter.get(
  "/:eventId/guests",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const guests = await prisma.guest.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
        plusOnes: true,
        dietary: true,
        checkedInAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    response.json({ guests });
  }),
);

eventsRouter.get(
  "/:eventId/categories",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const categories = await prisma.category.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      include: {
        candidates: {
          select: { id: true, name: true, description: true, votesCount: true },
          orderBy: { votesCount: "desc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    response.json({ categories });
  }),
);

eventsRouter.get(
  "/:eventId/ticket-tiers",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const tiers = await prisma.ticketTier.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { name: "asc" },
    });
    response.json({ tiers });
  }),
);

eventsRouter.get(
  "/:eventId/sessions",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const sessions = await prisma.eventSession.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { startsAt: "asc" },
    });
    response.json({ sessions });
  }),
);

eventsRouter.post(
  "/:eventId/guests",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = guestSchema.parse(request.body);
    const eventId = getRouteParam(request, "eventId");
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.type !== EventType.WEDDING) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const token = createOpaqueToken();
    const guest = await prisma.guest.create({
      data: {
        eventId,
        ...input,
        plusOnes: 0,
        plusOnesAllowed: input.plusOnes,
        rsvpTokenHash: hashOpaqueToken(token),
      },
      select: { id: true, name: true, phone: true, status: true },
    });
    const rsvpUrl = `${config.WEB_ORIGIN}/rsvp/${token}`;
    const sms = await sendEventSms(
      eventId,
      input.phone,
      `Hello ${input.name}, you're invited to ${event.title}. RSVP here: ${rsvpUrl}`,
    );
    response.status(201).json({ guest, rsvpUrl, smsStatus: sms.status });
  }),
);

eventsRouter.post(
  "/:eventId/categories",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = categorySchema.parse(request.body);
    const category = await prisma.category.create({
      data: { eventId: getRouteParam(request, "eventId"), name: input.name },
    });
    response.status(201).json({ category });
  }),
);

eventsRouter.post(
  "/:eventId/categories/:categoryId/candidates",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = candidateSchema.parse(request.body);
    const eventId = getRouteParam(request, "eventId");
    if (input.photoKey && !input.photoKey.startsWith(`events/${eventId}/uploads/`)) {
      response.status(400).json({ error: "Candidate photo must be uploaded to this event" });
      return;
    }
    const category = await prisma.category.findFirst({
      where: { id: getRouteParam(request, "categoryId"), eventId },
    });
    if (!category) {
      response.status(404).json({ error: "Category not found" });
      return;
    }
    const candidate = await prisma.candidate.create({
      data: { categoryId: category.id, ...input },
    });
    response.status(201).json({ candidate });
  }),
);

eventsRouter.post(
  "/:eventId/ticket-tiers",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = tierSchema.parse(request.body);
    const tier = await prisma.ticketTier.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        ...input,
        price: new Prisma.Decimal(input.price),
      },
    });
    response.status(201).json({ tier });
  }),
);

eventsRouter.post(
  "/:eventId/sessions",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = sessionSchema.parse(request.body);
    const session = await prisma.eventSession.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        ...input,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      },
    });
    response.status(201).json({ session });
  }),
);

eventsRouter.post(
  "/:eventId/uploads",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
      contentLength: z.number().int().positive(),
    }).parse(request.body);
    const result = await createAssetUpload(
      getRouteParam(request, "eventId"),
      input.filename,
      input.contentType,
      input.contentLength,
    );
    response.status(201).json(result);
  }),
);

eventsRouter.post(
  "/:eventId/vendors",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(1).max(160),
      service: z.string().trim().min(1).max(160),
      phone: z.string().trim().max(30).optional(),
      email: z.string().email().optional(),
      agreedCost: moneySchema().optional(),
      notes: z.string().trim().max(2000).optional(),
    }).parse(request.body);
    const vendor = await prisma.vendor.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        ...input,
        agreedCost: input.agreedCost === undefined ? undefined : new Prisma.Decimal(input.agreedCost),
      },
    });
    response.status(201).json({ vendor });
  }),
);

eventsRouter.get(
  "/:eventId/vendors",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const vendors = await prisma.vendor.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { createdAt: "desc" },
    });
    response.json({ vendors });
  }),
);

eventsRouter.post(
  "/:eventId/budget",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      category: z.string().trim().min(1).max(120),
      estimatedCost: moneySchema(),
      actualCost: moneySchema().optional(),
      paid: z.boolean().default(false),
    }).parse(request.body);
    const item = await prisma.budgetItem.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        category: input.category,
        estimatedCost: new Prisma.Decimal(input.estimatedCost),
        actualCost: input.actualCost === undefined ? undefined : new Prisma.Decimal(input.actualCost),
        paid: input.paid,
      },
    });
    response.status(201).json({ item });
  }),
);

eventsRouter.post(
  "/:eventId/check-in",
  requireEventStaffAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      token: z.string().min(20).max(200),
      kind: z.enum(["guest", "ticket"]),
    }).parse(request.body);
    const tokenHash = hashOpaqueToken(input.token);
    if (input.kind === "guest") {
      const guest = await prisma.guest.findFirst({
        where: {
          eventId: getRouteParam(request, "eventId"),
          passTokenHash: tokenHash,
          status: "ATTENDING",
        },
        select: { id: true, name: true, checkedInAt: true },
      });
      if (!guest) {
        response.status(404).json({ error: "Valid attendee pass not found" });
        return;
      }
      if (guest.checkedInAt) {
        response.status(409).json({ error: "Pass was already checked in", checkedInAt: guest.checkedInAt });
        return;
      }
      const result = await prisma.guest.updateMany({
        where: { id: guest.id, checkedInAt: null },
        data: { checkedInAt: new Date() },
      });
      if (result.count !== 1) {
        response.status(409).json({ error: "Pass was already checked in" });
        return;
      }
      response.json({ checkedIn: true, attendee: guest.name });
      return;
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        passTokenHash: tokenHash,
        order: { eventId: getRouteParam(request, "eventId"), status: "PAID" },
      },
      select: {
        id: true,
        checkedInAt: true,
        order: { select: { purchaserName: true } },
      },
    });
    if (!ticket) {
      response.status(404).json({ error: "Valid ticket pass not found" });
      return;
    }
    if (ticket.checkedInAt) {
      response.status(409).json({ error: "Pass was already checked in", checkedInAt: ticket.checkedInAt });
      return;
    }
    const result = await prisma.ticket.updateMany({
      where: { id: ticket.id, checkedInAt: null },
      data: { checkedInAt: new Date() },
    });
    if (result.count !== 1) {
      response.status(409).json({ error: "Pass was already checked in" });
      return;
    }
    response.json({ checkedIn: true, attendee: ticket.order.purchaserName });
  }),
);

eventsRouter.get(
  "/:eventId/budget",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const items = await prisma.budgetItem.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { createdAt: "desc" },
    });
    response.json({ items });
  }),
);

eventsRouter.post(
  "/:eventId/registry",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      title: z.string().trim().min(1).max(160),
      url: z.string().url().optional(),
      price: moneySchema().optional(),
    }).parse(request.body);
    const item = await prisma.registryItem.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        title: input.title,
        url: input.url,
        price: input.price === undefined ? undefined : new Prisma.Decimal(input.price),
      },
    });
    response.status(201).json({ item });
  }),
);

eventsRouter.get(
  "/:eventId/registry",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const items = await prisma.registryItem.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { createdAt: "desc" },
    });
    response.json({ items });
  }),
);

eventsRouter.post(
  "/:eventId/broadcast",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      message: z.string().trim().min(1).max(1000),
      statuses: z.array(z.enum(["ATTENDING", "DECLINED", "PENDING"])).optional(),
    }).parse(request.body);
    const guests = await prisma.guest.findMany({
      where: {
        eventId: getRouteParam(request, "eventId"),
        status: input.statuses ? { in: input.statuses } : undefined,
      },
      select: { phone: true },
      take: 250,
    });
    const results = [];
    for (let index = 0; index < guests.length; index += 10) {
      const batch = guests.slice(index, index + 10);
      results.push(...await Promise.all(
        batch.map((guest) => sendEventSms(getRouteParam(request, "eventId"), guest.phone, input.message)),
      ));
    }
    response.json({
      recipients: guests.length,
      sent: results.filter((result) => result.status === "SENT").length,
      failed: results.filter((result) => result.status === "FAILED").length,
    });
  }),
);
