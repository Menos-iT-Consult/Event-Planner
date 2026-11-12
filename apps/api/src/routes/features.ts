import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { MessageAudience, OrderStatus, Prisma, RefundStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { getRouteParam } from "../lib/route-param.js";
import { requireAuth, requireEventAccess, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { refundPaystackPayment } from "../services/payments.js";
import { collectProviderHealth, getProviderHealthHistory } from "../services/health.js";
import { optOutSms } from "../services/sms-preferences.js";

export const featuresPublicRouter = Router();
export const featuresAdminRouter = Router();

async function findRefundOrder(orderType: string, orderId: string, eventId: string) {
  if (orderType === "TICKET") {
    return prisma.ticketOrder.findFirst({
      where: { id: orderId, eventId },
      select: { id: true, eventId: true, paymentReference: true, amount: true, currency: true, status: true },
    });
  }
  if (orderType === "VOTE") {
    return prisma.votePurchase.findFirst({
      where: { id: orderId, eventId },
      select: { id: true, eventId: true, paymentReference: true, amount: true, currency: true, status: true },
    });
  }
  return null;
}

function refundMatchesOrder(
  refund: { eventId: string; orderType: string; orderId: string; paymentReference: string | null; amount: Prisma.Decimal; currency: string },
  order: Awaited<ReturnType<typeof findRefundOrder>>,
): order is NonNullable<typeof order> & { paymentReference: string } {
  return Boolean(
    order &&
    order.paymentReference &&
    order.eventId === refund.eventId &&
    (refund.orderType === "TICKET" || refund.orderType === "VOTE") &&
    order.id === refund.orderId &&
    order.paymentReference === refund.paymentReference &&
    order.amount.equals(refund.amount) &&
    order.currency === refund.currency,
  );
}

featuresPublicRouter.post(
  "/sms-opt-out",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many opt-out attempts. Please try again later." },
  }),
  asyncHandler(async (request, response) => {
    const input = z.object({ token: z.string().min(32).max(200) }).parse(request.body);
    if (!await optOutSms(input.token)) {
      response.status(404).json({ error: "This opt-out link is invalid or expired" });
      return;
    }
    response.json({ optedOut: true });
  }),
);

featuresPublicRouter.post(
  "/events/:slug/waitlist",
  asyncHandler(async (request, response) => {
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email().transform((email) => email.toLowerCase()),
      phone: z.string().trim().max(40).optional(),
      tierId: z.string().uuid().optional(),
    }).parse(request.body);
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    await prisma.waitlistEntry.upsert({
      where: { eventId_email: { eventId: event.id, email: input.email } },
      create: { eventId: event.id, ...input },
      update: { name: input.name, phone: input.phone, tierId: input.tierId, notified: false },
    });
    response.status(201).json({ joined: true });
  }),
);

featuresPublicRouter.post(
  "/events/:slug/surveys/:surveyId/responses",
  asyncHandler(async (request, response) => {
    const input = z.object({ answers: z.record(z.unknown()) }).parse(request.body);
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    const survey = await prisma.survey.findFirst({
      where: { id: getRouteParam(request, "surveyId"), eventId: event.id, isPublished: true },
      select: { id: true },
    });
    if (!survey) {
      response.status(404).json({ error: "Survey not found" });
      return;
    }
    await prisma.surveyResponse.create({
      data: { surveyId: survey.id, answers: input.answers as Prisma.InputJsonObject },
    });
    response.status(201).json({ submitted: true });
  }),
);

featuresPublicRouter.post(
  "/data-deletion-request",
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many privacy requests. Please try again later." },
  }),
  asyncHandler(async (request, response) => {
    const input = z.object({
      email: z.string().email().transform((email) => email.toLowerCase()),
      reason: z.string().trim().max(2000).optional(),
    }).parse(request.body);
    const requestRecord = await prisma.dataDeletionRequest.create({ data: input });
    response.status(202).json({ received: true, requestId: requestRecord.id });
  }),
);

featuresPublicRouter.post(
  "/consent",
  asyncHandler(async (request, response) => {
    const input = z.object({
      subjectType: z.enum(["ACCOUNT", "GUEST", "VOTER", "TICKET_BUYER"]),
      subjectId: z.string().trim().min(1).max(160),
      documentType: z.enum(["TERMS", "PRIVACY", "MARKETING", "DATA_PROCESSING"]),
      version: z.string().trim().min(1).max(40),
      eventId: z.string().uuid().optional(),
    }).parse(request.body);
    await prisma.consentRecord.create({
      data: {
        ...input,
        ipAddress: request.ip?.slice(0, 45),
      },
    });
    response.status(201).json({ recorded: true });
  }),
);

featuresPublicRouter.post(
  "/events/:slug/promo",
  asyncHandler(async (request, response) => {
    const input = z.object({ code: z.string().trim().min(3).max(40).transform((code) => code.toUpperCase()) }).parse(request.body);
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    const now = new Date();
    const promo = await prisma.promoCode.findFirst({
      where: {
        eventId: event.id,
        code: input.code,
        enabled: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
    });
    if (!promo || (promo.maxRedemptions !== null && promo.redemptions >= promo.maxRedemptions)) {
      response.status(404).json({ error: "Promotion code is invalid or expired" });
      return;
    }
    response.json({
      valid: true,
      code: promo.code,
      percentOff: promo.percentOff?.toFixed(2),
      amountOff: promo.amountOff?.toFixed(2),
    });
  }),
);

featuresPublicRouter.post(
  "/events/:slug/refunds",
  asyncHandler(async (request, response) => {
    const input = z.object({
      orderType: z.enum(["TICKET", "VOTE"]),
      orderId: z.string().trim().min(1).max(200),
      amount: z.coerce.number().positive().max(1_000_000),
      reason: z.string().trim().min(10).max(2000),
    }).parse(request.body);
    const event = await prisma.event.findFirst({
      where: { slug: getRouteParam(request, "slug"), isPublished: true },
      select: { id: true },
    });
    if (!event) {
      response.status(404).json({ error: "Event not found" });
      return;
    }
    let result: { error: "ORDER" | "AMOUNT" | "DUPLICATE" } | { refund: { id: string } };
    try {
      result = await prisma.$transaction(async (transaction) => {
        const order = input.orderType === "TICKET"
          ? await transaction.ticketOrder.findFirst({
            where: { id: input.orderId, eventId: event.id },
            select: { id: true, paymentReference: true, amount: true, currency: true, status: true },
          })
          : await transaction.votePurchase.findFirst({
            where: { id: input.orderId, eventId: event.id },
            select: { id: true, paymentReference: true, amount: true, currency: true, status: true },
          });
        if (!order || order.status !== OrderStatus.PAID || !order.paymentReference) {
          return { error: "ORDER" as const };
        }
        if (!new Prisma.Decimal(input.amount).equals(order.amount)) {
          return { error: "AMOUNT" as const };
        }
        const activeRefund = await transaction.refund.findFirst({
          where: {
            eventId: event.id,
            orderType: input.orderType,
            orderId: order.id,
            status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSING, RefundStatus.COMPLETED] },
          },
          select: { id: true },
        });
        if (activeRefund) return { error: "DUPLICATE" as const };
        return {
          refund: await transaction.refund.create({
            data: {
              eventId: event.id,
              orderType: input.orderType,
              orderId: order.id,
              paymentReference: order.paymentReference,
              amount: order.amount,
              currency: order.currency,
              reason: input.reason,
            },
          }),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        response.status(409).json({ error: "A refund request already exists or the order changed; reload and try again" });
        return;
      }
      throw error;
    }
    if ("error" in result) {
      const status = result.error === "ORDER" ? 404 : result.error === "AMOUNT" ? 400 : 409;
      const error = result.error === "ORDER"
        ? "Paid order not found"
        : result.error === "AMOUNT"
          ? "Refund requests must match the full paid order amount"
          : "A refund request already exists for this order";
      response.status(status).json({ error });
      return;
    }
    const refund = result.refund;
    response.status(202).json({ requested: true, refundId: refund.id });
  }),
);

featuresAdminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

featuresAdminRouter.get(
  "/data-deletion-requests",
  asyncHandler(async (_request, response) => {
    const requests = await prisma.dataDeletionRequest.findMany({
      take: 100,
      orderBy: { requestedAt: "desc" },
    });
    response.json({ requests });
  }),
);

featuresAdminRouter.patch(
  "/data-deletion-requests/:requestId/complete",
  asyncHandler(async (request, response) => {
    const requestId = z.string().uuid().parse(request.params.requestId);
    const actorId = (request as AuthenticatedRequest).user!.id;
    const result = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.dataDeletionRequest.updateMany({
        where: { id: requestId, completedAt: null },
        data: { completedAt: new Date() },
      });
      if (updated.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "DATA_DELETION_REQUEST_COMPLETED",
          entityType: "DATA_DELETION_REQUEST",
          entityId: requestId,
        },
      });
      return true;
    });
    if (!result) {
      response.status(404).json({ error: "Deletion request not found or already completed" });
      return;
    }
    response.json({ completed: true });
  }),
);

featuresAdminRouter.get(
  "/refunds",
  asyncHandler(async (_request, response) => {
    const refunds = await prisma.refund.findMany({
      include: { event: { select: { id: true, title: true } } },
      orderBy: { requestedAt: "desc" },
    });
    response.json({ refunds });
  }),
);

featuresAdminRouter.patch(
  "/refunds/:refundId",
  asyncHandler(async (request, response) => {
    const refundId = z.string().uuid().parse(request.params.refundId);
    const input = z.object({
      status: z.enum(["APPROVED", "REJECTED", "COMPLETED"]),
      reason: z.string().trim().max(2000).optional(),
    }).parse(request.body);
    const existing = await prisma.refund.findUnique({ where: { id: refundId } });
    if (!existing) {
      response.status(404).json({ error: "Refund not found" });
      return;
    }
    if (existing.status === RefundStatus.COMPLETED) {
      response.json({ refund: existing });
      return;
    }
    const now = new Date();
    if (existing.status === RefundStatus.PROCESSING) {
      if (!input.reason) {
        response.status(400).json({ error: "A provider verification note is required to resolve this refund" });
        return;
      }
      if (input.status === "COMPLETED") {
        const order = await findRefundOrder(existing.orderType, existing.orderId, existing.eventId);
        if (
          !refundMatchesOrder(existing, order) ||
          (order.status !== OrderStatus.PAID && order.status !== OrderStatus.REFUNDED)
        ) {
          response.status(409).json({ error: "The refund no longer matches its paid order" });
          return;
        }
        const refund = await prisma.$transaction(async (transaction) => {
          await transaction.refund.update({
            where: { id: refundId, status: RefundStatus.PROCESSING },
            data: { status: RefundStatus.COMPLETED, reason: input.reason, resolvedAt: now },
          });
          if (existing.orderType === "TICKET") {
            const updatedOrder = await transaction.ticketOrder.updateMany({
              where: { id: existing.orderId, eventId: existing.eventId, status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] } },
              data: { status: OrderStatus.REFUNDED },
            });
            if (updatedOrder.count !== 1) throw new Error("Refunded ticket order changed during reconciliation");
          } else {
            const updatedOrder = await transaction.votePurchase.updateMany({
              where: { id: existing.orderId, eventId: existing.eventId, status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] } },
              data: { status: OrderStatus.REFUNDED },
            });
            if (updatedOrder.count !== 1) throw new Error("Refunded vote order changed during reconciliation");
          }
          return transaction.refund.findUniqueOrThrow({ where: { id: refundId } });
        });
        response.json({ refund });
        return;
      }
      if (input.status === "APPROVED") {
        const updated = await prisma.refund.updateMany({
          where: { id: refundId, status: RefundStatus.PROCESSING },
          data: { status: RefundStatus.APPROVED, reason: input.reason, resolvedAt: null },
        });
        if (updated.count !== 1) {
          response.status(409).json({ error: "Refund status changed; reload and try again" });
          return;
        }
        response.json({ refund: await prisma.refund.findUniqueOrThrow({ where: { id: refundId } }) });
        return;
      }
      const updated = await prisma.refund.updateMany({
        where: { id: refundId, status: RefundStatus.PROCESSING },
        data: { status: RefundStatus.REJECTED, reason: input.reason, resolvedAt: now },
      });
      if (updated.count !== 1) {
        response.status(409).json({ error: "Refund status changed; reload and try again" });
        return;
      }
      response.json({ refund: await prisma.refund.findUniqueOrThrow({ where: { id: refundId } }) });
      return;
    }

    if (existing.status !== RefundStatus.REQUESTED && existing.status !== RefundStatus.APPROVED) {
      response.status(409).json({ error: "Refund status changed; reload and try again" });
      return;
    }
    if (input.status === "COMPLETED") {
      if (existing.status !== RefundStatus.APPROVED) {
        response.status(409).json({ error: "Approve the refund before completing it" });
        return;
      }
      const order = await findRefundOrder(existing.orderType, existing.orderId, existing.eventId);
      if (
        !refundMatchesOrder(existing, order) ||
        order.status !== OrderStatus.PAID ||
        !existing.paymentReference
      ) {
        response.status(409).json({ error: "The refund no longer matches its paid order" });
        return;
      }
      const claimed = await prisma.refund.updateMany({
        where: { id: refundId, status: RefundStatus.APPROVED },
        data: { status: RefundStatus.PROCESSING },
      });
      if (claimed.count !== 1) {
        response.status(409).json({ error: "Refund status changed; reload and try again" });
        return;
      }
      try {
        await refundPaystackPayment(existing.paymentReference);
      } catch (error) {
        console.error("Could not confirm Paystack refund result", { refundId, error });
        response.status(502).json({
          error: "Paystack could not confirm the refund. Verify its status with the provider before resolving this request.",
        });
        return;
      }
      const refund = await prisma.$transaction(async (transaction) => {
        await transaction.refund.update({
          where: { id: refundId, status: RefundStatus.PROCESSING },
          data: { status: RefundStatus.COMPLETED, resolvedAt: now },
        });
        if (existing.orderType === "TICKET") {
          const updatedOrder = await transaction.ticketOrder.updateMany({
            where: { id: existing.orderId, eventId: existing.eventId, status: OrderStatus.PAID },
            data: { status: OrderStatus.REFUNDED },
          });
          if (updatedOrder.count !== 1) throw new Error("Refunded ticket order changed during completion");
        } else {
          const updatedOrder = await transaction.votePurchase.updateMany({
            where: { id: existing.orderId, eventId: existing.eventId, status: OrderStatus.PAID },
            data: { status: OrderStatus.REFUNDED },
          });
          if (updatedOrder.count !== 1) throw new Error("Refunded vote order changed during completion");
        }
        return transaction.refund.findUniqueOrThrow({ where: { id: refundId } });
      });
      response.json({ refund });
      return;
    }

    const updated = await prisma.refund.updateMany({
      where: { id: refundId, status: RefundStatus.REQUESTED },
      data: {
        status: input.status as RefundStatus,
        reason: input.reason ?? existing.reason,
        resolvedAt: input.status === "REJECTED" ? now : undefined,
      },
    });
    if (updated.count !== 1) {
      response.status(409).json({ error: "Refund status changed; reload and try again" });
      return;
    }
    response.json({ refund: await prisma.refund.findUniqueOrThrow({ where: { id: refundId } }) });
  }),
);

featuresAdminRouter.get(
  "/provider-health",
  asyncHandler(async (_request, response) => {
    const [smsFailures, failedJobs, deadJobs, pendingJobs, deletionRequests, providers] = await Promise.all([
      prisma.smsLog.count({ where: { status: "FAILED" } }),
      prisma.backgroundJob.count({ where: { status: "FAILED" } }),
      prisma.backgroundJob.count({ where: { status: "DEAD" } }),
      prisma.backgroundJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
      prisma.dataDeletionRequest.count({ where: { completedAt: null } }),
      collectProviderHealth(),
    ]);
    const history = await getProviderHealthHistory();
    response.json({
      providers,
      history,
      operations: { smsFailures, failedJobs, deadJobs, pendingJobs, deletionRequests },
    });
  }),
);

featuresAdminRouter.get(
  "/jobs",
  asyncHandler(async (_request, response) => {
    const jobs = await prisma.backgroundJob.findMany({
      take: 100,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    response.json({ jobs });
  }),
);

featuresAdminRouter.patch(
  "/jobs/:jobId/retry",
  asyncHandler(async (request, response) => {
    const jobId = z.string().uuid().parse(request.params.jobId);
    const retried = await prisma.backgroundJob.updateMany({
      where: { id: jobId, status: { in: ["FAILED", "DEAD"] } },
      data: { status: "QUEUED", attempts: 0, runAt: new Date(), error: null, startedAt: null, completedAt: null },
    });
    if (retried.count !== 1) {
      response.status(409).json({ error: "Only failed or dead jobs can be retried" });
      return;
    }
    response.json({ job: await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } }) });
  }),
);

export const featuresEventRouter = Router();
featuresEventRouter.use(requireAuth);

featuresEventRouter.get(
  "/:eventId/message-schedules",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const schedules = await prisma.eventMessageSchedule.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { scheduledAt: "desc" },
      take: 50,
    });
    response.json({ schedules });
  }),
);

featuresEventRouter.post(
  "/:eventId/message-schedules",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      message: z.string().trim().min(1).max(1000),
      audience: z.nativeEnum(MessageAudience).default(MessageAudience.ALL_GUESTS),
      scheduledAt: z.string().datetime(),
    }).parse(request.body);
    const scheduledAt = new Date(input.scheduledAt);
    if (scheduledAt.getTime() < Date.now() + 2 * 60_000) {
      response.status(400).json({ error: "Schedule messages at least two minutes in the future" });
      return;
    }
    const eventId = getRouteParam(request, "eventId");
    const actor = (request as AuthenticatedRequest).user!;
    const schedule = await prisma.$transaction(async (transaction) => {
      const created = await transaction.eventMessageSchedule.create({
        data: {
          eventId,
          createdById: actor.id,
          message: input.message,
          audience: input.audience,
          scheduledAt,
        },
      });
      await transaction.backgroundJob.create({
        data: {
          eventId,
          type: "SEND_SCHEDULED_SMS",
          runAt: scheduledAt,
          payload: { scheduleId: created.id },
        },
      });
      return created;
    });
    response.status(201).json({ schedule });
  }),
);

featuresEventRouter.delete(
  "/:eventId/message-schedules/:scheduleId",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const eventId = getRouteParam(request, "eventId");
    const scheduleId = z.string().uuid().parse(getRouteParam(request, "scheduleId"));
    const changed = await prisma.eventMessageSchedule.updateMany({
      where: { id: scheduleId, eventId, status: "SCHEDULED", scheduledAt: { gt: new Date() } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (changed.count !== 1) {
      response.status(409).json({ error: "This message can no longer be cancelled" });
      return;
    }
    response.json({ cancelled: true });
  }),
);

featuresEventRouter.post(
  "/:eventId/promos",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      code: z.string().trim().min(3).max(40).transform((code) => code.toUpperCase()),
      percentOff: z.coerce.number().positive().max(100).optional(),
      amountOff: z.coerce.number().positive().max(1_000_000).optional(),
      maxRedemptions: z.coerce.number().int().positive().optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
    }).refine((value) => Boolean(value.percentOff || value.amountOff), {
      message: "Choose a percentage or fixed amount discount",
    }).parse(request.body);
    const promo = await prisma.promoCode.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        code: input.code,
        percentOff: input.percentOff === undefined ? undefined : new Prisma.Decimal(input.percentOff),
        amountOff: input.amountOff === undefined ? undefined : new Prisma.Decimal(input.amountOff),
        maxRedemptions: input.maxRedemptions,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      },
    });
    response.status(201).json({ promo });
  }),
);

featuresEventRouter.get(
  "/:eventId/waitlist",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const entries = await prisma.waitlistEntry.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { createdAt: "desc" },
    });
    response.json({ entries });
  }),
);

featuresEventRouter.post(
  "/:eventId/seats",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      section: z.string().trim().min(1).max(80),
      row: z.string().trim().min(1).max(20),
      number: z.string().trim().min(1).max(20),
      reservedBy: z.string().trim().min(1).max(160).optional(),
      ticketId: z.string().uuid().optional(),
    }).parse(request.body);
    const seat = await prisma.seat.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        ...input,
        reservedAt: input.reservedBy ? new Date() : undefined,
      },
    });
    response.status(201).json({ seat });
  }),
);

featuresEventRouter.get(
  "/:eventId/seats",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const seats = await prisma.seat.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: [{ section: "asc" }, { row: "asc" }, { number: "asc" }],
    });
    response.json({ seats });
  }),
);

featuresEventRouter.post(
  "/:eventId/surveys",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      title: z.string().trim().min(2).max(160),
      description: z.string().trim().max(2000).optional(),
      questions: z.array(z.record(z.unknown())).min(1).max(100),
      isPublished: z.boolean().default(false),
    }).parse(request.body);
    const survey = await prisma.survey.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        ...input,
        questions: input.questions as Prisma.InputJsonObject[],
      },
    });
    response.status(201).json({ survey });
  }),
);

featuresEventRouter.post(
  "/:eventId/certificates",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      recipientName: z.string().trim().min(2).max(160),
      recipientEmail: z.string().email(),
      title: z.string().trim().min(2).max(200),
      objectKey: z.string().trim().max(500).optional(),
    }).parse(request.body);
    const certificate = await prisma.certificate.create({
      data: { eventId: getRouteParam(request, "eventId"), ...input },
    });
    await prisma.backgroundJob.create({
      data: {
        type: "ISSUE_CERTIFICATE",
        eventId: getRouteParam(request, "eventId"),
        payload: { certificateId: certificate.id },
      },
    });
    response.status(201).json({ certificate });
  }),
);

featuresEventRouter.post(
  "/:eventId/recurring",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
      interval: z.number().int().min(1).max(365).default(1),
      weekday: z.number().int().min(0).max(6).optional(),
      dayOfMonth: z.number().int().min(1).max(31).optional(),
      until: z.string().datetime().optional(),
      timezone: z.string().trim().min(2).max(80).default("Africa/Accra"),
    }).parse(request.body);
    const schedule = await prisma.recurringSchedule.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        ...input,
        until: input.until ? new Date(input.until) : undefined,
      },
    });
    response.status(201).json({ schedule });
  }),
);

featuresEventRouter.get(
  "/:eventId/promos",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const promos = await prisma.promoCode.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { createdAt: "desc" },
    });
    response.json({ promos });
  }),
);

featuresEventRouter.get(
  "/:eventId/surveys",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const surveys = await prisma.survey.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      include: { _count: { select: { responses: true } } },
      orderBy: { createdAt: "desc" },
    });
    response.json({ surveys });
  }),
);

featuresEventRouter.get(
  "/:eventId/certificates",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const certificates = await prisma.certificate.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { issuedAt: "desc" },
    });
    response.json({ certificates });
  }),
);

featuresEventRouter.get(
  "/:eventId/recurring",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const schedules = await prisma.recurringSchedule.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { createdAt: "desc" },
    });
    response.json({ schedules });
  }),
);

featuresEventRouter.post(
  "/:eventId/invoices",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const input = z.object({
      customerName: z.string().trim().min(2).max(160),
      customerEmail: z.string().email(),
      subtotal: z.coerce.number().positive().max(1_000_000),
      taxRate: z.coerce.number().min(0).max(100).default(0),
      currency: z.string().length(3).transform((value) => value.toUpperCase()).default("GHS"),
      dueAt: z.string().datetime().optional(),
      lines: z.array(z.object({
        description: z.string().trim().min(1).max(240),
        quantity: z.number().int().positive().max(100000),
        unitPrice: z.number().positive().max(1_000_000),
      })).min(1).max(100),
    }).parse(request.body);
    const taxRate = new Prisma.Decimal(input.taxRate);
    const subtotal = new Prisma.Decimal(input.subtotal);
    const taxAmount = subtotal.mul(taxRate).div(100);
    const total = subtotal.add(taxAmount);
    const count = await prisma.invoice.count({ where: { eventId: getRouteParam(request, "eventId") } });
    const invoice = await prisma.invoice.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        number: `INV-${String(count + 1).padStart(5, "0")}`,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        subtotal,
        taxRate,
        taxAmount,
        total,
        currency: input.currency,
        lines: input.lines as Prisma.InputJsonObject[],
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      },
    });
    await prisma.backgroundJob.create({
      data: {
        eventId: getRouteParam(request, "eventId"),
        type: "SEND_EMAIL",
        payload: {
          to: input.customerEmail,
          subject: `Invoice ${invoice.number}`,
          text: `Invoice ${invoice.number} for ${invoice.total.toFixed(2)} ${invoice.currency} is ready.`,
        },
      },
    });
    response.status(201).json({ invoice });
  }),
);

featuresEventRouter.get(
  "/:eventId/invoices",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const invoices = await prisma.invoice.findMany({
      where: { eventId: getRouteParam(request, "eventId") },
      orderBy: { issuedAt: "desc" },
    });
    response.json({ invoices });
  }),
);

featuresEventRouter.patch(
  "/:eventId/waitlist/:entryId/notified",
  requireEventAccess,
  asyncHandler(async (request, response) => {
    const eventId = getRouteParam(request, "eventId");
    const entryId = z.string().uuid().parse(getRouteParam(request, "entryId"));
    const existing = await prisma.waitlistEntry.findFirst({
      where: { id: entryId, eventId },
      select: { id: true },
    });
    if (!existing) {
      response.status(404).json({ error: "Waitlist entry not found for this event" });
      return;
    }
    const entry = await prisma.waitlistEntry.update({
      where: { id: entryId },
      data: { notified: true },
    });
    response.json({ entry });
  }),
);
