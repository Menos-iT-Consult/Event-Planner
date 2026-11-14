import { Router, type Response } from "express";
import { Prisma, TaskStatus, VendorStatus } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { moneySchema } from "../lib/money.js";
import { createOpaqueToken, hashOpaqueToken } from "../lib/tokens.js";
import { getRouteParam } from "../lib/route-param.js";
import { requireAdminMfa, requireAuth, requireEventAccess } from "../middleware/auth.js";
import { sendEventSms } from "../services/messaging.js";

export const weddingRouter = Router();
weddingRouter.use(requireAuth, requireAdminMfa);

const faqSchema = z.array(z.object({
  question: z.string().trim().min(1).max(200),
  answer: z.string().trim().min(1).max(1000),
})).max(20);

const profileSchema = z.object({
  headline: z.string().trim().max(160).optional().nullable(),
  welcomeMessage: z.string().trim().max(1000).optional().nullable(),
  story: z.string().trim().max(5000).optional().nullable(),
  dressCode: z.string().trim().max(500).optional().nullable(),
  travelInfo: z.string().trim().max(3000).optional().nullable(),
  faq: faqSchema.optional(),
  invitationMessage: z.string().trim().max(1000).optional().nullable(),
  showStory: z.boolean().default(true),
  showDressCode: z.boolean().default(true),
  showTravelInfo: z.boolean().default(true),
  showSchedule: z.boolean().default(true),
  showRegistry: z.boolean().default(true),
  rsvpEnabled: z.boolean().default(true),
  showRsvpDeadline: z.boolean().default(true),
  rsvpDeadline: z.string().datetime().optional().nullable(),
});

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Date must be a valid YYYY-MM-DD date");

const weddingDaySchema = z.object({
  name: z.string().trim().min(1).max(120),
  date: dateOnlySchema,
  location: z.string().trim().max(240).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  category: z.string().trim().min(1).max(80).default("GENERAL"),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
  priority: z.number().int().min(0).max(10).default(0),
  dueAt: z.string().datetime().optional().nullable(),
  assigneeId: z.string().uuid().optional().nullable(),
});

async function getWeddingEvent(eventId: string, response: Response) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, type: "WEDDING" },
    select: { id: true, organizationId: true, startDate: true, endDate: true, title: true, location: true, slug: true },
  });
  if (event) {
    response.locals.eventId = event.id;
    response.locals.organizationId = event.organizationId;
  }
  return event;
}

function isWithinWedding(event: { startDate: Date; endDate: Date }, date: Date): boolean {
  return date >= event.startDate && date <= event.endDate;
}

weddingRouter.get(
  "/:eventId/wedding/profile",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const profile = await prisma.weddingProfile.findUnique({ where: { eventId: event.id } });
    response.json({ profile });
  }),
);

weddingRouter.put(
  "/:eventId/wedding/profile",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = profileSchema.parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const lastWeddingMoment = new Date(event.endDate);
    lastWeddingMoment.setUTCHours(23, 59, 59, 999);
    if (input.rsvpDeadline && new Date(input.rsvpDeadline) > lastWeddingMoment) {
      response.status(400).json({ error: "RSVP deadline must be on or before the wedding end date" });
      return;
    }
    const profile = await prisma.weddingProfile.upsert({
      where: { eventId: event.id },
      create: {
        eventId: event.id,
        ...input,
        rsvpDeadline: input.rsvpDeadline ? new Date(input.rsvpDeadline) : null,
        faq: input.faq as Prisma.InputJsonValue | undefined,
      },
      update: {
        ...input,
        rsvpDeadline: input.rsvpDeadline ? new Date(input.rsvpDeadline) : input.rsvpDeadline,
        faq: input.faq as Prisma.InputJsonValue | undefined,
      },
    });
    response.json({ profile });
  }),
);

weddingRouter.get(
  "/:eventId/wedding/days",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const days = await prisma.weddingDay.findMany({
      where: { eventId: event.id },
      include: { _count: { select: { sessions: true, seatingPlans: true } } },
      orderBy: [{ date: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    response.json({ days });
  }),
);

weddingRouter.post(
  "/:eventId/wedding/days",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = weddingDaySchema.parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const date = new Date(`${input.date}T00:00:00.000Z`);
    if (!isWithinWedding(event, date)) {
      response.status(400).json({ error: "Wedding day must fall within the wedding date range" });
      return;
    }
    const day = await prisma.weddingDay.create({
      data: { eventId: event.id, ...input, date },
    });
    response.status(201).json({ day });
  }),
);

weddingRouter.patch(
  "/:eventId/wedding/days/:dayId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = weddingDaySchema.partial().parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const dayId = getRouteParam(request, "dayId");
    const current = await prisma.weddingDay.findFirst({ where: { id: dayId, eventId: event.id } });
    if (!current) {
      response.status(404).json({ error: "Wedding day not found" });
      return;
    }
    const date = input.date ? new Date(`${input.date}T00:00:00.000Z`) : current.date;
    if (!isWithinWedding(event, date)) {
      response.status(400).json({ error: "Wedding day must fall within the wedding date range" });
      return;
    }
    const day = await prisma.weddingDay.update({
      where: { id: dayId },
      data: { ...input, date },
    });
    response.json({ day });
  }),
);

weddingRouter.delete(
  "/:eventId/wedding/days/:dayId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const deleted = await prisma.weddingDay.deleteMany({
      where: { id: getRouteParam(request, "dayId"), eventId: event.id },
    });
    if (deleted.count !== 1) {
      response.status(404).json({ error: "Wedding day not found" });
      return;
    }
    response.status(204).end();
  }),
);

weddingRouter.get(
  "/:eventId/wedding/checklist",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const tasks = await prisma.eventTask.findMany({
      where: { eventId: event.id },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
    });
    response.json({ tasks });
  }),
);

weddingRouter.post(
  "/:eventId/wedding/checklist",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = taskSchema.parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    if (input.assigneeId) {
      const membership = await prisma.eventMembership.findUnique({
        where: { userId_eventId: { userId: input.assigneeId, eventId: event.id } },
        select: { userId: true },
      });
      if (!membership) {
        response.status(400).json({ error: "Task assignee must be a member of this event" });
        return;
      }
    }
    const task = await prisma.eventTask.create({
      data: {
        eventId: event.id,
        ...input,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        completedAt: input.status === TaskStatus.DONE ? new Date() : null,
      },
    });
    response.status(201).json({ task });
  }),
);

weddingRouter.patch(
  "/:eventId/wedding/checklist/:taskId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = taskSchema.partial().parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const taskId = getRouteParam(request, "taskId");
    const current = await prisma.eventTask.findFirst({ where: { id: taskId, eventId: event.id } });
    if (!current) {
      response.status(404).json({ error: "Checklist task not found" });
      return;
    }
    if (input.assigneeId) {
      const membership = await prisma.eventMembership.findUnique({
        where: { userId_eventId: { userId: input.assigneeId, eventId: event.id } },
        select: { userId: true },
      });
      if (!membership) {
        response.status(400).json({ error: "Task assignee must be a member of this event" });
        return;
      }
    }
    const status = input.status ?? current.status;
    const task = await prisma.eventTask.update({
      where: { id: taskId },
      data: {
        ...input,
        dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
        completedAt: status === TaskStatus.DONE
          ? current.completedAt ?? new Date()
          : null,
      },
    });
    response.json({ task });
  }),
);

weddingRouter.delete(
  "/:eventId/wedding/checklist/:taskId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const deleted = await prisma.eventTask.deleteMany({
      where: { id: getRouteParam(request, "taskId"), eventId: event.id },
    });
    if (deleted.count !== 1) {
      response.status(404).json({ error: "Checklist task not found" });
      return;
    }
    response.status(204).end();
  }),
);

weddingRouter.get(
  "/:eventId/wedding/households",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const households = await prisma.guestHousehold.findMany({
      where: { eventId: event.id },
      include: { guests: { select: { id: true, name: true, status: true, plusOnes: true } } },
      orderBy: { name: "asc" },
    });
    response.json({ households });
  }),
);

weddingRouter.post(
  "/:eventId/wedding/households",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(1).max(160),
      notes: z.string().trim().max(1000).optional(),
    }).parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const household = await prisma.guestHousehold.create({
      data: { eventId: event.id, ...input },
    });
    response.status(201).json({ household });
  }),
);

weddingRouter.patch(
  "/:eventId/wedding/guests/:guestId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      householdId: z.string().uuid().nullable().optional(),
      name: z.string().trim().min(1).max(120).optional(),
      phone: z.string().trim().min(1).max(40).optional(),
      email: z.string().email().nullable().optional(),
      plusOnesAllowed: z.number().int().min(0).max(20).optional(),
      dietary: z.string().trim().max(500).nullable().optional(),
    }).parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    if (input.householdId) {
      const household = await prisma.guestHousehold.findFirst({
        where: { id: input.householdId, eventId: event.id },
        select: { id: true },
      });
      if (!household) {
        response.status(400).json({ error: "Household must belong to this wedding" });
        return;
      }
    }
    const updated = await prisma.guest.updateMany({
      where: { id: getRouteParam(request, "guestId"), eventId: event.id },
      data: input,
    });
    if (updated.count !== 1) {
      response.status(404).json({ error: "Wedding guest not found" });
      return;
    }
    const guest = await prisma.guest.findUniqueOrThrow({
      where: { id: getRouteParam(request, "guestId") },
      select: { id: true, name: true, householdId: true, status: true },
    });
    response.json({ guest });
  }),
);

weddingRouter.post(
  "/:eventId/wedding/invitations",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      guestIds: z.array(z.string().uuid()).min(1).max(50),
      message: z.string().trim().max(1000).optional(),
    }).parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const [guests, profile] = await Promise.all([
      prisma.guest.findMany({
        where: { eventId: event.id, id: { in: input.guestIds } },
        select: { id: true, name: true, phone: true },
      }),
      prisma.weddingProfile.findUnique({ where: { eventId: event.id } }),
    ]);
    if (guests.length !== new Set(input.guestIds).size) {
      response.status(400).json({ error: "One or more selected guests do not belong to this wedding" });
      return;
    }

    const template = input.message ?? profile?.invitationMessage ??
      "Hello {name}, you're invited to {event}. RSVP here: {rsvpUrl}";
    const results: Array<{ guestId: string; status: string }> = [];
    for (const guest of guests) {
      const token = createOpaqueToken();
      await prisma.guest.update({
        where: { id: guest.id },
        data: { rsvpTokenHash: hashOpaqueToken(token) },
      });
      const rsvpUrl = `${config.WEB_ORIGIN}/rsvp/${token}`;
      const body = template
        .replaceAll("{name}", guest.name)
        .replaceAll("{event}", event.title)
        .replaceAll("{date}", event.startDate.toISOString().slice(0, 10))
        .replaceAll("{location}", event.location)
        .replaceAll("{rsvpUrl}", rsvpUrl);
      const message = body.includes(rsvpUrl) ? body : `${body}\nRSVP: ${rsvpUrl}`;
      const sent = await sendEventSms(event.id, guest.phone, message);
      if (sent.status === "SENT") {
        await prisma.guest.update({ where: { id: guest.id }, data: { invitationSentAt: new Date() } });
      }
      results.push({ guestId: guest.id, status: sent.status });
    }
    response.json({
      invited: results.filter((result) => result.status === "SENT").length,
      failed: results.filter((result) => result.status !== "SENT").length,
      results,
    });
  }),
);

weddingRouter.get(
  "/:eventId/wedding/seating",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const [plans, unassignedGuests] = await Promise.all([
      prisma.seatingPlan.findMany({
        where: { eventId: event.id },
        include: { assignments: true },
        orderBy: { name: "asc" },
      }),
      prisma.guest.findMany({
        where: { eventId: event.id, status: "ATTENDING", seatingAssignments: { none: {} } },
        select: { id: true, name: true, householdId: true },
        orderBy: { name: "asc" },
      }),
    ]);
    response.json({ plans, unassignedGuests });
  }),
);

weddingRouter.post(
  "/:eventId/wedding/seating",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(1).max(120),
      capacity: z.number().int().min(0).max(10000).default(0),
      notes: z.string().trim().max(1000).optional(),
      weddingDayId: z.string().uuid().optional().nullable(),
    }).parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    if (input.weddingDayId) {
      const day = await prisma.weddingDay.findFirst({
        where: { id: input.weddingDayId, eventId: event.id },
        select: { id: true },
      });
      if (!day) {
        response.status(400).json({ error: "Wedding day must belong to this wedding" });
        return;
      }
    }
    const plan = await prisma.seatingPlan.create({
      data: { eventId: event.id, ...input },
    });
    response.status(201).json({ plan });
  }),
);

weddingRouter.post(
  "/:eventId/wedding/seating/:planId/assignments",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      guestId: z.string().uuid(),
      tableName: z.string().trim().max(80).optional(),
      seatLabel: z.string().trim().max(40).optional(),
      notes: z.string().trim().max(500).optional(),
    }).parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const planId = getRouteParam(request, "planId");
    const result = await prisma.$transaction(async (transaction) => {
      const plan = await transaction.seatingPlan.findFirst({
        where: { id: planId, eventId: event.id },
      });
      if (!plan) return { error: "plan" as const };
      await transaction.$queryRaw`SELECT "id" FROM "SeatingPlan" WHERE "id" = ${plan.id} FOR UPDATE`;
      const guest = await transaction.guest.findFirst({
        where: { id: input.guestId, eventId: event.id, status: "ATTENDING" },
        select: { id: true, name: true },
      });
      if (!guest) return { error: "guest" as const };
      const existing = await transaction.seatingAssignment.findFirst({
        where: { eventId: event.id, guestId: guest.id },
        select: { id: true },
      });
      if (existing) return { error: "assigned" as const };
      const count = await transaction.seatingAssignment.count({ where: { planId: plan.id } });
      if (plan.capacity > 0 && count >= plan.capacity) return { error: "capacity" as const };
      const assignment = await transaction.seatingAssignment.create({
        data: {
          eventId: event.id,
          planId: plan.id,
          guestId: guest.id,
          attendeeName: guest.name,
          tableName: input.tableName,
          seatLabel: input.seatLabel,
          notes: input.notes,
        },
      });
      return { assignment };
    });
    if ("error" in result && result.error) {
      const errors = {
        plan: [404, "Seating plan not found"],
        guest: [404, "Only an attending guest from this wedding can be seated"],
        assigned: [409, "This guest is already assigned to a seating plan"],
        capacity: [409, "This seating plan has reached capacity"],
      } as const;
      const [statusCode, error] = errors[result.error];
      response.status(statusCode).json({ error });
      return;
    }
    response.status(201).json({ assignment: result.assignment });
  }),
);

weddingRouter.delete(
  "/:eventId/wedding/seating/:planId/assignments/:assignmentId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const deleted = await prisma.seatingAssignment.deleteMany({
      where: {
        id: getRouteParam(request, "assignmentId"),
        planId: getRouteParam(request, "planId"),
        eventId: event.id,
      },
    });
    if (deleted.count !== 1) {
      response.status(404).json({ error: "Seating assignment not found" });
      return;
    }
    response.status(204).end();
  }),
);

weddingRouter.patch(
  "/:eventId/vendors/:vendorId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      status: z.nativeEnum(VendorStatus).optional(),
      quotedCost: moneySchema().nullable().optional(),
      agreedCost: moneySchema().nullable().optional(),
      paidAmount: moneySchema().nullable().optional(),
      paymentDueAt: z.string().datetime().nullable().optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
    }).parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    const updated = await prisma.vendor.updateMany({
      where: { id: getRouteParam(request, "vendorId"), eventId: event.id },
      data: {
        ...input,
        quotedCost: input.quotedCost === undefined ? undefined : input.quotedCost === null ? null : new Prisma.Decimal(input.quotedCost),
        agreedCost: input.agreedCost === undefined ? undefined : input.agreedCost === null ? null : new Prisma.Decimal(input.agreedCost),
        paidAmount: input.paidAmount === undefined ? undefined : input.paidAmount === null ? null : new Prisma.Decimal(input.paidAmount),
        paymentDueAt: input.paymentDueAt === undefined ? undefined : input.paymentDueAt ? new Date(input.paymentDueAt) : null,
      },
    });
    if (updated.count !== 1) {
      response.status(404).json({ error: "Wedding vendor not found" });
      return;
    }
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: getRouteParam(request, "vendorId") } });
    response.json({ vendor });
  }),
);

weddingRouter.patch(
  "/:eventId/budget/:itemId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      category: z.string().trim().min(1).max(120).optional(),
      estimatedCost: moneySchema().optional(),
      actualCost: moneySchema().nullable().optional(),
      paid: z.boolean().optional(),
      dueAt: z.string().datetime().nullable().optional(),
      vendorId: z.string().uuid().nullable().optional(),
    }).parse(request.body);
    const event = await getWeddingEvent(getRouteParam(request, "eventId"), response);
    if (!event) {
      response.status(404).json({ error: "Wedding event not found" });
      return;
    }
    if (input.vendorId) {
      const vendor = await prisma.vendor.findFirst({
        where: { id: input.vendorId, eventId: event.id },
        select: { id: true },
      });
      if (!vendor) {
        response.status(400).json({ error: "Budget vendor must belong to this wedding" });
        return;
      }
    }
    const updated = await prisma.budgetItem.updateMany({
      where: { id: getRouteParam(request, "itemId"), eventId: event.id },
      data: {
        ...input,
        estimatedCost: input.estimatedCost === undefined ? undefined : new Prisma.Decimal(input.estimatedCost),
        actualCost: input.actualCost === undefined ? undefined : input.actualCost === null ? null : new Prisma.Decimal(input.actualCost),
        dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
      },
    });
    if (updated.count !== 1) {
      response.status(404).json({ error: "Wedding budget item not found" });
      return;
    }
    const item = await prisma.budgetItem.findUniqueOrThrow({ where: { id: getRouteParam(request, "itemId") } });
    response.json({ item });
  }),
);
