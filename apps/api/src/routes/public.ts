import { Router } from "express";
import { EventType, OrderStatus, Prisma, RsvpStatus, type TicketOrder, type Vote } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { hashOpaqueToken, hashVoterIdentity, createOpaqueToken } from "../lib/tokens.js";
import { createPassQr } from "../services/passes.js";
import { sendEventSms } from "../services/messaging.js";
import { createPrivateObjectUrl, deletePrivateObject } from "../services/storage.js";
import { initializePaystackPayment } from "../services/payments.js";
import { phoneNumberSchema, voterContactSchema } from "../lib/contact.js";
import { getRouteParam } from "../lib/route-param.js";

export const publicRouter = Router();

async function resolvePromoDiscount(eventId: string, code: string | undefined, amount: Prisma.Decimal) {
  if (!code) return { amount, promo: null };
  const now = new Date();
  const promo = await prisma.promoCode.findFirst({
    where: {
      eventId,
      code: code.trim().toUpperCase(),
      enabled: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
  });
  if (!promo || (promo.maxRedemptions !== null && promo.redemptions >= promo.maxRedemptions)) {
    throw new Error("PROMO_INVALID");
  }
  let discounted = amount;
  if (promo.percentOff) discounted = amount.mul(new Prisma.Decimal(100).sub(promo.percentOff)).div(100);
  if (promo.amountOff) {
    discounted = discounted.sub(promo.amountOff);
    if (discounted.isNegative()) discounted = new Prisma.Decimal(0);
  }
  return { amount: discounted.toDecimalPlaces(2), promo };
}

publicRouter.post(
  "/contact",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many contact requests. Please try again later." },
  }),
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email().transform((email) => email.toLowerCase()),
      message: z.string().trim().min(10).max(5000),
    }).parse(request.body);
    const message = await prisma.contactMessage.create({ data: input });
    response.status(201).json({ submitted: true, id: message.id });
  }),
);

publicRouter.get(
  "/events",
  asyncHandler(async (request, response) => {
    const input = z.object({
      search: z.string().trim().max(100).optional(),
      type: z.enum(["WEDDING", "VOTING", "GENERAL"]).optional(),
      location: z.string().trim().max(120).optional(),
      from: z.string().datetime({ offset: true }).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(12),
    }).parse(request.query);

    const where: Prisma.EventWhereInput = {
      isPublished: true,
      ...(input.type ? { type: input.type } : {}),
      ...(input.location ? { location: { contains: input.location, mode: "insensitive" } } : {}),
      ...(input.search ? {
        OR: [
          { title: { contains: input.search, mode: "insensitive" } },
          { location: { contains: input.search, mode: "insensitive" } },
          { description: { contains: input.search, mode: "insensitive" } },
        ],
      } : {}),
      ...(input.from ? { endDate: { gte: new Date(input.from) } } : {}),
    };

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { startDate: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          slug: true,
          title: true,
          type: true,
          startDate: true,
          endDate: true,
          location: true,
          description: true,
          currency: true,
        },
      }),
      prisma.event.count({ where }),
    ]);
    response.json({
      events,
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        pageCount: Math.ceil(total / input.pageSize),
      },
    });
  }),
);

publicRouter.post(
  "/events/:slug/register",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many registration requests. Please try again later." },
  }),
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email().transform((email) => email.toLowerCase()),
      phone: phoneNumberSchema,
      dietary: z.string().trim().max(500).optional(),
      quantity: z.number().int().min(1).max(10).default(1),
    }).parse(request.body);
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true, title: true, type: true, startDate: true, location: true },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    if (event.type !== EventType.GENERAL) {
      response.status(400).json({ error: "Free registration is available for general events only" });
      return;
    }

    const passToken = createOpaqueToken();
    let qrObjectKey: string;
    try {
      qrObjectKey = await createPassQr(event.id, passToken);
    } catch (error) {
      console.error("Could not create free registration pass", { eventId: event.id, error });
      response.status(503).json({ error: "Registration is temporarily unavailable. Please try again." });
      return;
    }

    let guest;
    try {
      guest = await prisma.guest.create({
        data: {
          eventId: event.id,
          name: input.name,
          phone: input.phone,
          email: input.email,
          status: RsvpStatus.ATTENDING,
          plusOnes: input.quantity - 1,
          dietary: input.dietary || null,
          passTokenHash: hashOpaqueToken(passToken),
          qrObjectKey,
        },
      });
    } catch (error) {
      try {
        await deletePrivateObject(qrObjectKey);
      } catch (cleanupError) {
        console.error("Could not remove registration pass after database failure", {
          eventId: event.id,
          error: cleanupError,
        });
      }
      throw error;
    }

    const passUrl = `${config.WEB_ORIGIN}/pass/${passToken}`;
    await sendEventSms(
      event.id,
      input.phone,
      `Registration confirmed for ${event.title}. Your pass: ${passUrl}`,
    );

    response.status(201).json({
      registration: {
        id: guest.id,
        name: guest.name,
        quantity: input.quantity,
        passUrl,
        event: { title: event.title, startDate: event.startDate, location: event.location },
      },
    });
  }),
);

const voteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many voting requests. Please try again later." },
});

publicRouter.get(
  "/rsvp/:token",
  asyncHandler(async (request, response) => {
    const guest = await prisma.guest.findUnique({
      where: { rsvpTokenHash: hashOpaqueToken(getRouteParam(request, "token")) },
      select: {
        name: true,
        plusOnesAllowed: true,
        status: true,
        dietary: true,
        event: {
          select: {
            title: true,
            startDate: true,
            endDate: true,
            location: true,
            weddingProfile: { select: { rsvpEnabled: true, rsvpDeadline: true } },
          },
        },
      },
    });
    if (!guest) {
      response.status(404).json({ error: "RSVP link is invalid or expired" });
      return;
    }
    if (guest.event.weddingProfile?.rsvpEnabled === false) {
      response.status(410).json({ error: "Online RSVPs are closed for this wedding" });
      return;
    }
    if (guest.event.weddingProfile?.rsvpDeadline && guest.event.weddingProfile.rsvpDeadline < new Date()) {
      response.status(410).json({ error: "The RSVP deadline has passed" });
      return;
    }
    response.json({
      invitation: {
        ...guest,
        rsvpDeadline: guest.event.weddingProfile?.rsvpDeadline ?? null,
      },
    });
  }),
);

publicRouter.get(
  "/events/:slug",
  asyncHandler(async (request, response) => {
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: {
        id: true,
        slug: true,
        title: true,
        type: true,
        startDate: true,
        endDate: true,
        location: true,
        description: true,
        currency: true,
        voteUnitPrice: true,
        categories: {
          select: {
            id: true,
            name: true,
            candidates: {
              select: { id: true, name: true, description: true, photoKey: true, votesCount: true },
              orderBy: { votesCount: "desc" },
            },
          },
        },
        ticketTiers: {
          select: { id: true, name: true, description: true, price: true, quantity: true, sold: true },
        },
        sessions: {
          where: {
            OR: [
              { weddingDayId: null },
              { weddingDay: { isPublic: true } },
            ],
          },
          select: { id: true, title: true, description: true, location: true, startsAt: true, endsAt: true, speaker: true, weddingDayId: true },
          orderBy: { startsAt: "asc" },
        },
        registry: {
          where: { claimed: false },
          select: { id: true, title: true, category: true, url: true, price: true, quantity: true, claimedCount: true },
        },
        weddingProfile: {
          select: {
            headline: true,
            welcomeMessage: true,
            story: true,
            dressCode: true,
            travelInfo: true,
            faq: true,
            showStory: true,
            showDressCode: true,
            showTravelInfo: true,
            showSchedule: true,
            showRegistry: true,
            showRsvpDeadline: true,
            rsvpDeadline: true,
            rsvpEnabled: true,
          },
        },
        weddingDays: {
          where: { isPublic: true },
          select: { id: true, name: true, date: true, location: true, sortOrder: true },
          orderBy: [{ date: "asc" }, { sortOrder: "asc" }],
        },
      },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }

    const candidates = event.categories.flatMap((category) => category.candidates);
    const photos = await Promise.all(
      candidates.map(async (candidate) => [
        candidate.id,
        candidate.photoKey ? await createPrivateObjectUrl(candidate.photoKey) : null,
      ] as const),
    );
    const photoUrls = new Map(photos);
    response.json({
      event: {
        ...event,
        sessions: event.type === EventType.WEDDING && event.weddingProfile?.showSchedule === false
          ? []
          : event.sessions,
        registry: event.type === EventType.WEDDING && event.weddingProfile?.showRegistry === false
          ? []
          : event.registry,
        weddingProfile: event.weddingProfile
          ? {
              ...event.weddingProfile,
              story: event.weddingProfile.showStory ? event.weddingProfile.story : null,
              dressCode: event.weddingProfile.showDressCode ? event.weddingProfile.dressCode : null,
              travelInfo: event.weddingProfile.showTravelInfo ? event.weddingProfile.travelInfo : null,
              rsvpDeadline: event.weddingProfile.showRsvpDeadline ? event.weddingProfile.rsvpDeadline : null,
              faq: Array.isArray(event.weddingProfile.faq) ? event.weddingProfile.faq : [],
            }
          : null,
        categories: event.categories.map((category) => ({
          ...category,
          candidates: category.candidates.map((candidate) => ({
            ...candidate,
            photoUrl: photoUrls.get(candidate.id) ?? null,
            photoKey: undefined,
          })),
        })),
      },
    });
  }),
);

publicRouter.post(
  "/registry/:itemId/claim",
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(1).max(120),
    }).parse(request.body);
    const itemId = getRouteParam(request, "itemId");
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "RegistryItem" WHERE "id" = ${itemId} FOR UPDATE`;
      const item = await transaction.registryItem.findFirst({
        where: { id: itemId, event: { isPublished: true } },
        select: { id: true, quantity: true, claimedCount: true },
      });
      if (!item || item.claimedCount >= item.quantity) return false;
      const claimedCount = item.claimedCount + 1;
      await transaction.registryItem.update({
        where: { id: item.id },
        data: { claimedCount, claimed: claimedCount >= item.quantity, claimedBy: input.name },
      });
      await transaction.registryGiftClaim.create({
        data: { itemId: item.id, name: input.name },
      });
      return true;
    });
    if (!result) {
      response.status(409).json({ error: "This gift has already been claimed" });
      return;
    }
    response.json({ claimed: true });
  }),
);

publicRouter.post(
  "/rsvp/:token",
  asyncHandler(async (request, response) => {
    const input = z.object({
      status: z.enum(["ATTENDING", "DECLINED"]),
      plusOnes: z.number().int().min(0).max(20).optional(),
      dietary: z.string().trim().max(500).optional(),
    }).parse(request.body);
    const token = getRouteParam(request, "token");
    const tokenHash = hashOpaqueToken(token);
    const guest = await prisma.guest.findUnique({
      where: { rsvpTokenHash: tokenHash },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            weddingProfile: { select: { rsvpEnabled: true, rsvpDeadline: true } },
          },
        },
      },
    });
    if (!guest) {
      response.status(404).json({ error: "RSVP link is invalid or expired" });
      return;
    }
    if (guest.event.weddingProfile?.rsvpEnabled === false) {
      response.status(409).json({ error: "Online RSVPs are closed for this wedding" });
      return;
    }
    if (guest.event.weddingProfile?.rsvpDeadline && guest.event.weddingProfile.rsvpDeadline < new Date()) {
      response.status(409).json({ error: "The RSVP deadline has passed" });
      return;
    }
    if (input.plusOnes !== undefined && input.plusOnes > guest.plusOnesAllowed) {
      response.status(400).json({ error: "Plus-ones exceed the invitation allowance" });
      return;
    }

    const passToken = input.status === RsvpStatus.ATTENDING
      ? token
      : null;
    let qrObjectKey: string | null = null;
    let passError: string | undefined;
    if (passToken && !guest.qrObjectKey) {
      try {
        qrObjectKey = await createPassQr(guest.eventId, passToken);
      } catch (error) {
        passError = "Your RSVP was saved, but we could not prepare the digital pass yet";
        console.error("Could not create RSVP pass", { guestId: guest.id, error });
      }
    }
    const activeQrKey = passToken ? qrObjectKey ?? guest.qrObjectKey : null;

    const updated = await prisma.guest.update({
      where: { id: guest.id },
      data: {
        status: input.status,
        plusOnes: input.plusOnes,
        dietary: input.dietary,
        passTokenHash: passToken ? tokenHash : null,
        qrObjectKey: activeQrKey,
      },
      select: { id: true, name: true, status: true, plusOnes: true },
    });
    const receipt = input.status === RsvpStatus.ATTENDING
      ? `Thank you, ${guest.name}. Your RSVP for ${guest.event.title} is confirmed.${activeQrKey ? ` Your pass: ${config.WEB_ORIGIN}/pass/${passToken}` : ""}`
      : `Thank you, ${guest.name}. Your response for ${guest.event.title} has been recorded.`;
    const sms = await sendEventSms(guest.eventId, guest.phone, receipt);
    if (!activeQrKey && guest.qrObjectKey) {
      try {
        await deletePrivateObject(guest.qrObjectKey);
      } catch (error) {
        console.error("Could not delete revoked RSVP pass", { guestId: guest.id, error });
      }
    }
    response.json({
      guest: updated,
      passUrl: activeQrKey && passToken ? `${config.WEB_ORIGIN}/pass/${passToken}` : null,
      smsStatus: sms.status,
      passError,
    });
  }),
);

publicRouter.post(
  "/events/:slug/votes",
  voteLimiter,
  asyncHandler(async (request, response) => {
    const input = z.object({
      candidateId: z.string().uuid(),
      voterContact: voterContactSchema,
    }).parse(request.body);
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true, type: true, title: true },
    });
    if (!event || event.type !== EventType.VOTING) {
      response.status(404).json({ error: "Voting event not found" });
      return;
    }
    const candidate = await prisma.candidate.findFirst({
      where: {
        id: input.candidateId,
        category: { eventId: event.id },
      },
      select: { id: true, categoryId: true },
    });
    if (!candidate) {
      response.status(404).json({ error: "Candidate not found for this event" });
      return;
    }
    const voterHash = hashVoterIdentity(input.voterContact, event.id);
    let vote: Vote;
    try {
      vote = await prisma.$transaction(async (transaction) => {
        const created = await transaction.vote.create({
          data: {
            eventId: event.id,
            categoryId: candidate.categoryId,
            candidateId: candidate.id,
            voterHash,
          },
        });
        await transaction.candidate.update({
          where: { id: candidate.id },
          data: { votesCount: { increment: 1 } },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        response.status(409).json({ error: "You have already voted in this category" });
        return;
      }
      throw error;
    }
    const contact = /^\+?[1-9]\d{7,14}$/.test(input.voterContact);
    if (contact) {
      await sendEventSms(event.id, input.voterContact, `Your vote for ${event.title} has been recorded.`);
    }
    response.status(201).json({ voteId: vote.id, message: "Vote recorded" });
  }),
);

publicRouter.post(
  "/events/:slug/vote-checkout",
  voteLimiter,
  asyncHandler(async (request, response) => {
    const input = z.object({
      candidateId: z.string().uuid(),
      quantity: z.number().int().min(1).max(100),
      email: z.string().email(),
      phone: phoneNumberSchema,
      promoCode: z.string().trim().min(3).max(40).optional(),
    }).parse(request.body);
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true, type: true, title: true, currency: true, voteUnitPrice: true },
    });
    if (!event || event.type !== EventType.VOTING) {
      response.status(404).json({ error: "Voting event not found" });
      return;
    }
    if (!event.voteUnitPrice || event.currency !== "GHS") {
      response.status(400).json({ error: "Paid voting is not enabled for this event" });
      return;
    }
    const candidate = await prisma.candidate.findFirst({
      where: { id: input.candidateId, category: { eventId: event.id } },
      select: { id: true, categoryId: true },
    });
    if (!candidate) {
      response.status(404).json({ error: "Candidate not found for this event" });
      return;
    }

    const reference = `EVF-VOTE-${randomUUID()}`;
    let discountedAmount: Prisma.Decimal;
    let promo: Awaited<ReturnType<typeof resolvePromoDiscount>>["promo"];
    try {
      const resolved = await resolvePromoDiscount(event.id, input.promoCode, event.voteUnitPrice.mul(input.quantity));
      discountedAmount = resolved.amount;
      promo = resolved.promo;
    } catch (error) {
      if (error instanceof Error && error.message === "PROMO_INVALID") {
        response.status(400).json({ error: "Promotion code is invalid or expired" });
        return;
      }
      throw error;
    }
    const purchase = await prisma.votePurchase.create({
      data: {
        eventId: event.id,
        categoryId: candidate.categoryId,
        candidateId: candidate.id,
        voterHash: hashVoterIdentity(input.email, event.id),
        voterEmail: input.email,
        voterPhone: input.phone,
        quantity: input.quantity,
        amount: discountedAmount,
        currency: event.currency,
        paymentReference: reference,
      },
    });
    try {
      const payment = await initializePaystackPayment({
        email: input.email,
        amountMinor: purchase.amount.mul(100).toNumber(),
        reference,
          metadata: { votePurchaseId: purchase.id, eventId: event.id, quantity: input.quantity, promoCode: input.promoCode ?? "" },
      });
      response.status(201).json({
        authorizationUrl: payment.authorizationUrl,
        reference: payment.reference,
      });
    } catch (error) {
      await prisma.votePurchase.update({
        where: { id: purchase.id },
        data: { status: OrderStatus.FAILED },
      });
      console.error("Paystack vote checkout initialization failed", error);
      response.status(502).json({ error: "Could not start payment. Please try again." });
    }
  }),
);

publicRouter.get(
  "/events/:slug/leaderboard",
  asyncHandler(async (request, response) => {
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true, type: true },
    });
    if (!event || event.type !== EventType.VOTING) {
      response.status(404).json({ error: "Voting event not found" });
      return;
    }
    const categories = await prisma.category.findMany({
      where: { eventId: event.id },
      select: {
        id: true,
        name: true,
        candidates: {
          select: { id: true, name: true, description: true, votesCount: true },
          orderBy: { votesCount: "desc" },
        },
      },
    });
    response.json({ categories });
  }),
);

publicRouter.post(
  "/events/:slug/checkout",
  asyncHandler(async (request, response) => {
    const input = z.object({
      ticketTierId: z.string().uuid(),
      quantity: z.number().int().min(1).max(10),
      purchaserName: z.string().trim().min(1).max(120),
      purchaserEmail: z.string().email(),
      purchaserPhone: phoneNumberSchema,
      promoCode: z.string().trim().min(3).max(40).optional(),
    }).parse(request.body);
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true, title: true, currency: true },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    if (event.currency !== "GHS") {
      response.status(400).json({ error: "Paystack checkout currently supports GHS events only" });
      return;
    }
    const tier = await prisma.ticketTier.findFirst({
      where: { id: input.ticketTierId, eventId: event.id },
      select: { id: true, price: true, quantity: true },
    });
    if (!tier) {
      response.status(404).json({ error: "Ticket tier not found" });
      return;
    }
    let discountedAmount: Prisma.Decimal;
    try {
      discountedAmount = (await resolvePromoDiscount(event.id, input.promoCode, tier.price.mul(input.quantity))).amount;
    } catch (error) {
      if (error instanceof Error && error.message === "PROMO_INVALID") {
        response.status(400).json({ error: "Promotion code is invalid or expired" });
        return;
      }
      throw error;
    }

    const accessToken = createOpaqueToken();
    const reference = `EVF-${randomUUID()}`;
    let order: TicketOrder;
    try {
      order = await prisma.$transaction(async (transaction) => {
        const reserved = await transaction.ticketTier.updateMany({
          where: {
            id: tier.id,
            eventId: event.id,
            sold: { lte: tier.quantity - input.quantity },
          },
          data: { sold: { increment: input.quantity } },
        });
        if (reserved.count !== 1) {
          throw new Error("TICKETS_UNAVAILABLE");
        }
        return transaction.ticketOrder.create({
          data: {
            eventId: event.id,
            ticketTierId: tier.id,
            purchaserName: input.purchaserName,
            purchaserEmail: input.purchaserEmail,
            purchaserPhone: input.purchaserPhone,
            quantity: input.quantity,
            amount: discountedAmount,
            currency: event.currency,
            paymentReference: reference,
            accessTokenHash: hashOpaqueToken(accessToken),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TICKETS_UNAVAILABLE") {
        response.status(409).json({ error: "Not enough tickets remain in this tier" });
        return;
      }
      throw error;
    }

    try {
      const payment = await initializePaystackPayment({
        email: input.purchaserEmail,
        amountMinor: order.amount.mul(100).toNumber(),
        reference,
          metadata: { orderId: order.id, eventId: event.id, quantity: input.quantity, promoCode: input.promoCode ?? "" },
      });
      response.status(201).json({
        authorizationUrl: payment.authorizationUrl,
        reference: payment.reference,
        orderAccessUrl: `${config.WEB_ORIGIN}/passes/${accessToken}`,
      });
    } catch (error) {
      await prisma.$transaction([
        prisma.ticketOrder.update({ where: { id: order.id }, data: { status: OrderStatus.FAILED } }),
        prisma.ticketTier.update({ where: { id: tier.id }, data: { sold: { decrement: input.quantity } } }),
      ]);
      console.error("Paystack checkout initialization failed", error);
      response.status(502).json({ error: "Could not start payment. Please try again." });
    }
  }),
);

publicRouter.get(
  "/passes/:token",
  asyncHandler(async (request, response) => {
    const tokenHash = hashOpaqueToken(getRouteParam(request, "token"));
    const [guest, ticket, order] = await Promise.all([
      prisma.guest.findUnique({
        where: { passTokenHash: tokenHash },
        select: { id: true, name: true, status: true, checkedInAt: true, qrObjectKey: true, event: { select: { title: true } } },
      }),
      prisma.ticket.findUnique({
        where: { passTokenHash: tokenHash },
        select: {
          id: true,
          checkedInAt: true,
          qrObjectKey: true,
          order: { select: { purchaserName: true, status: true, event: { select: { title: true } } } },
        },
      }),
      prisma.ticketOrder.findUnique({
        where: { accessTokenHash: tokenHash },
        select: {
          purchaserName: true,
          status: true,
          event: { select: { title: true } },
          tickets: { select: { id: true, checkedInAt: true, qrObjectKey: true } },
        },
      }),
    ]);

    if (guest?.qrObjectKey) {
      response.json({
        pass: {
          name: guest.name,
          eventTitle: guest.event.title,
          status: guest.status,
          checkedInAt: guest.checkedInAt,
          qrUrl: await createPrivateObjectUrl(guest.qrObjectKey),
        },
      });
      return;
    }
    if (ticket?.qrObjectKey && ticket.order.status === OrderStatus.PAID) {
      response.json({
        pass: {
          name: ticket.order.purchaserName,
          eventTitle: ticket.order.event.title,
          checkedInAt: ticket.checkedInAt,
          qrUrl: await createPrivateObjectUrl(ticket.qrObjectKey),
        },
      });
      return;
    }
    if (order) {
      if (order.status !== OrderStatus.PAID) {
        response.status(409).json({ error: "Payment has not been confirmed yet" });
        return;
      }
      const passes = await Promise.all(order.tickets.map(async (item) => ({
        id: item.id,
        checkedInAt: item.checkedInAt,
        qrUrl: item.qrObjectKey ? await createPrivateObjectUrl(item.qrObjectKey) : null,
      })));
      response.json({
        order: { purchaserName: order.purchaserName, eventTitle: order.event.title },
        passes,
      });
      return;
    }

    response.status(404).json({ error: "Pass not found or no longer available" });
  }),
);
