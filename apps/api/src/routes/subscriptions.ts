import { BillingProvider, OrganizationRole, SubscriptionStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { createOpaqueToken } from "../lib/tokens.js";
import { moneySchema } from "../lib/money.js";
import { addSubscriptionPeriod } from "../lib/subscription-period.js";
import {
  requireAdminMfa,
  requireAuth,
  requireOrganizationAccess,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import { initializeMoolrePayment, initializePaystackPayment } from "../services/payments.js";

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth, requireAdminMfa);

function isProviderConfigured(provider: BillingProvider): boolean {
  if (provider === BillingProvider.PAYSTACK) return Boolean(config.PAYSTACK_SECRET_KEY);
  return Boolean(
    config.MOOLRE_API_USER &&
    config.MOOLRE_API_PUBKEY &&
    config.MOOLRE_ACCOUNT_NUMBER &&
    config.MOOLRE_BILLING_EMAIL &&
    config.MOOLRE_CALLBACK_SECRET
  );
}

subscriptionsRouter.get(
  "/plans",
  asyncHandler(async (_request, response) => {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        currency: true,
        interval: true,
        features: true,
        maxEvents: true,
        maxMembers: true,
      },
      orderBy: [{ price: "asc" }, { name: "asc" }],
    });
    response.json({
      plans: plans.map((plan) => ({
        ...plan,
        features: Array.isArray(plan.features)
          ? plan.features.filter((feature): feature is string => typeof feature === "string")
          : [],
      })),
      providers: {
        [BillingProvider.PAYSTACK]: isProviderConfigured(BillingProvider.PAYSTACK),
        [BillingProvider.MOOLRE]: isProviderConfigured(BillingProvider.MOOLRE),
      },
    });
  }),
);

subscriptionsRouter.get(
  "/organizations/:organizationId",
  requireOrganizationAccess(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.FINANCE,
  ),
  asyncHandler(async (request, response) => {
    const organizationId = request.params.organizationId!;
    const [subscription, invoices] = await Promise.all([
      prisma.organizerSubscription.findFirst({
        where: {
          organizationId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
          currentPeriodEnd: { gt: new Date() },
        },
        include: { plan: { select: { id: true, name: true, price: true, currency: true, interval: true, maxEvents: true, maxMembers: true } } },
        orderBy: { currentPeriodEnd: "desc" },
      }),
      prisma.subscriptionInvoice.findMany({
        where: { organizationId },
        select: {
          id: true,
          plan: { select: { name: true } },
          provider: true,
          amount: true,
          currency: true,
          status: true,
          reference: true,
          createdAt: true,
          paidAt: true,
          expiresAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    response.json({ subscription, invoices });
  }),
);

subscriptionsRouter.post(
  "/organizations/:organizationId/checkout",
  requireOrganizationAccess(OrganizationRole.OWNER, OrganizationRole.ADMIN),
  asyncHandler(async (request, response) => {
    const input = z.object({
      planId: z.string().min(1).max(100),
      provider: z.nativeEnum(BillingProvider),
    }).parse(request.body);
    if (!isProviderConfigured(input.provider)) {
      response.status(503).json({ error: `${input.provider} subscription billing is not configured` });
      return;
    }
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { id: input.planId, active: true },
      select: { id: true, price: true, currency: true, interval: true },
    });
    if (!plan) {
      response.status(404).json({ error: "Subscription plan not found" });
      return;
    }
    if (plan.price.lessThanOrEqualTo(0) || plan.currency !== "GHS") {
      response.status(400).json({ error: "Online subscription checkout requires a positive GHS plan price" });
      return;
    }
    const organizationId = request.params.organizationId!;
    const actor = (request as AuthenticatedRequest).user!;
    const payer = await prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { email: true },
    });
    const reference = `sub-${createOpaqueToken()}`;
    const invoice = await prisma.subscriptionInvoice.create({
      data: {
        organizationId,
        planId: plan.id,
        provider: input.provider,
        reference,
        amount: plan.price,
        currency: plan.currency,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
      select: { id: true, reference: true, amount: true },
    });
    let initialized: Awaited<ReturnType<typeof initializePaystackPayment>>;
    try {
      initialized = input.provider === BillingProvider.PAYSTACK
        ? await initializePaystackPayment({
            email: payer.email,
            amountMinor: invoice.amount.mul(100).toNumber(),
            reference: invoice.reference,
            metadata: { kind: "organization_subscription", invoiceId: invoice.id, organizationId },
          })
        : await initializeMoolrePayment({
            amount: invoice.amount.toFixed(2),
            reference: invoice.reference,
            metadata: { kind: "organization_subscription", invoiceId: invoice.id, organizationId },
          });
    } catch (error) {
      await prisma.subscriptionInvoice.updateMany({
        where: { id: invoice.id, status: "PENDING" },
        data: { status: "FAILED" },
      });
      throw error;
    }
    await prisma.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { checkoutUrl: initialized.authorizationUrl },
    });
    response.status(201).json({
      invoice: { id: invoice.id, reference: invoice.reference, provider: input.provider },
      checkoutUrl: initialized.authorizationUrl,
    });
  }),
);

export async function activateSubscriptionInvoice(
  invoiceId: string,
  providerTransactionId: string,
): Promise<"activated" | "duplicate" | "not_found"> {
  return prisma.$transaction(async (transaction) => {
    const invoice = await transaction.subscriptionInvoice.findUnique({
      where: { id: invoiceId },
      include: { plan: { select: { interval: true } } },
    });
    if (!invoice) return "not_found";
    await transaction.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${invoice.organizationId} FOR UPDATE`;
    const claimed = await transaction.subscriptionInvoice.updateMany({
      where: { id: invoice.id, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (claimed.count !== 1) return "duplicate";

    const now = new Date();
    const current = await transaction.organizerSubscription.findFirst({
      where: {
        organizationId: invoice.organizationId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
        currentPeriodEnd: { gt: now },
      },
      orderBy: { currentPeriodEnd: "desc" },
    });
    const periodStart = current && current.currentPeriodEnd > now ? current.currentPeriodEnd : now;
    const periodEnd = addSubscriptionPeriod(periodStart, invoice.plan.interval);

    if (current) {
      await transaction.organizerSubscription.update({
        where: { id: current.id },
        data: {
          planId: invoice.planId,
          status: SubscriptionStatus.ACTIVE,
          providerRef: providerTransactionId,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelledAt: null,
        },
      });
    } else {
      await transaction.organizerSubscription.create({
        data: {
          organizationId: invoice.organizationId,
          planId: invoice.planId,
          status: SubscriptionStatus.ACTIVE,
          providerRef: providerTransactionId,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        },
      });
    }
    await transaction.auditLog.create({
      data: {
        organizationId: invoice.organizationId,
        action: "SUBSCRIPTION_ACTIVATED",
        entityType: "subscription",
        entityId: invoice.id,
        metadata: { provider: invoice.provider, planId: invoice.planId },
      },
    });
    return "activated";
  });
}

export async function failSubscriptionInvoice(reference: string, provider: BillingProvider): Promise<void> {
  await prisma.subscriptionInvoice.updateMany({
    where: { reference, provider, status: "PENDING" },
    data: { status: "FAILED" },
  });
}

