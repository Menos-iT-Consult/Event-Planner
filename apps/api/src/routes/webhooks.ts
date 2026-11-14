import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { BillingProvider, OrderStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { createOpaqueToken, hashOpaqueToken } from "../lib/tokens.js";
import { createPassQr } from "../services/passes.js";
import { sendEventSms } from "../services/messaging.js";
import { refundPaystackPayment, verifyPaystackSignature } from "../services/payments.js";
import { deletePrivateObject } from "../services/storage.js";
import { activateSubscriptionInvoice, failSubscriptionInvoice } from "./subscriptions.js";

const webhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string(),
    status: z.string(),
    amount: z.number().int().nonnegative(),
    currency: z.string(),
    id: z.union([z.string(), z.number()]).optional(),
    metadata: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
  }),
});

const moolreCallbackSchema = z.object({
  secret: z.string().max(256).optional(),
  callback_secret: z.string().max(256).optional(),
  status: z.union([z.string(), z.number()]).optional(),
  code: z.string().optional(),
  externalref: z.string().optional(),
  transactionid: z.union([z.string(), z.number()]).optional(),
  accountnumber: z.string().optional(),
  amount: z.union([
    z.number().nonnegative(),
    z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  ]).optional(),
  currency: z.string().optional(),
  data: z.object({
    status: z.union([z.string(), z.number()]).optional(),
    code: z.string().optional(),
    externalref: z.string().optional(),
    transactionid: z.union([z.string(), z.number()]).optional(),
    accountnumber: z.string().optional(),
    amount: z.union([
      z.number().nonnegative(),
      z.string().regex(/^\d+(?:\.\d{1,2})?$/),
    ]).optional(),
    currency: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export const webhooksRouter = Router();

function matchesCallbackSecret(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

async function incrementPromoRedemption(eventId: string, code: unknown): Promise<void> {
  if (typeof code !== "string" || !code.trim()) return;
  const promo = await prisma.promoCode.findFirst({
    where: {
      eventId,
      code: code.trim().toUpperCase(),
      enabled: true,
    },
    select: { id: true, redemptions: true, maxRedemptions: true },
  });
  if (!promo) return;
  if (promo.maxRedemptions !== null && promo.redemptions >= promo.maxRedemptions) return;
  await prisma.promoCode.update({
    where: { id: promo.id },
    data: { redemptions: { increment: 1 } },
  });
}

async function removeOrphanedPasses(keys: string[]): Promise<void> {
  const results = await Promise.allSettled(keys.map((key) => deletePrivateObject(key)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("Could not remove an orphaned pass image", { key: keys[index], error: result.reason });
    }
  });
}

webhooksRouter.post(
  "/paystack",
  asyncHandler(async (request, response) => {
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({ error: "Expected raw webhook body" });
      return;
    }
    if (!verifyPaystackSignature(
      request.body,
      request.header("x-paystack-signature"),
    )) {
      response.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(request.body.toString("utf8"));
    } catch {
      response.status(400).json({ error: "Invalid webhook JSON" });
      return;
    }
    const webhook = webhookSchema.parse(payload);
    if (webhook.event === "charge.failed") {
      await failSubscriptionInvoice(webhook.data.reference, BillingProvider.PAYSTACK);
      response.status(200).json({ received: true });
      return;
    }
    if (webhook.event !== "charge.success" || webhook.data.status !== "success") {
      response.status(200).json({ received: true });
      return;
    }

    const subscriptionInvoice = await prisma.subscriptionInvoice.findUnique({
      where: { reference: webhook.data.reference },
    });
    if (subscriptionInvoice) {
      if (subscriptionInvoice.provider !== BillingProvider.PAYSTACK) {
        response.status(200).json({ received: true, ignored: true });
        return;
      }
      if (
        subscriptionInvoice.amount.mul(100).comparedTo(new Prisma.Decimal(webhook.data.amount)) !== 0 ||
        webhook.data.currency !== subscriptionInvoice.currency
      ) {
        response.status(400).json({ error: "Payment amount or currency does not match the subscription invoice" });
        return;
      }
      const activation = await activateSubscriptionInvoice(
        subscriptionInvoice.id,
        String(webhook.data.id ?? webhook.data.reference),
      );
      response.status(200).json({ received: true, subscription: activation });
      return;
    }

    const [order, votePurchase] = await Promise.all([
      prisma.ticketOrder.findUnique({
      where: { paymentReference: webhook.data.reference },
      include: { event: { select: { title: true } } },
      }),
      prisma.votePurchase.findUnique({
        where: { paymentReference: webhook.data.reference },
        include: { event: { select: { title: true } } },
      }),
    ]);
    if (!order && !votePurchase) {
      response.status(200).json({ received: true, ignored: true });
      return;
    }
    if (votePurchase && !order) {
      const expectedMinorUnits = votePurchase.amount.mul(100);
      if (
        expectedMinorUnits.comparedTo(new Prisma.Decimal(webhook.data.amount)) !== 0 ||
        webhook.data.currency !== votePurchase.currency
      ) {
        response.status(400).json({ error: "Payment amount or currency does not match the vote purchase" });
        return;
      }
      if (votePurchase.status === OrderStatus.PAID) {
        response.status(200).json({ received: true, duplicate: true });
        return;
      }
      if (votePurchase.status !== OrderStatus.PENDING) {
        response.status(200).json({ received: true, ignored: true });
        return;
      }
      const fulfilled = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.votePurchase.updateMany({
          where: { id: votePurchase.id, status: OrderStatus.PENDING },
          data: { status: OrderStatus.PAID, paidAt: new Date() },
        });
        if (updated.count !== 1) return false;
        await transaction.candidate.update({
          where: { id: votePurchase.candidateId },
          data: { votesCount: { increment: votePurchase.quantity } },
        });
        return true;
      });
      if (!fulfilled) {
        response.status(200).json({ received: true, duplicate: true });
        return;
      }
      await incrementPromoRedemption(votePurchase.eventId, webhook.data.metadata?.promoCode);
      const sms = await sendEventSms(
        votePurchase.eventId,
        votePurchase.voterPhone,
        `Payment confirmed. Your ${votePurchase.quantity} vote${votePurchase.quantity === 1 ? "" : "s"} for ${votePurchase.event.title} have been recorded.`,
      );
      response.status(200).json({ received: true, smsStatus: sms.status });
      return;
    }
    if (!order) {
      response.status(200).json({ received: true, ignored: true });
      return;
    }
    const expectedMinorUnits = order.amount.mul(100);
    if (
      expectedMinorUnits.comparedTo(new Prisma.Decimal(webhook.data.amount)) !== 0 ||
      webhook.data.currency !== order.currency
    ) {
      response.status(400).json({ error: "Payment amount or currency does not match the order" });
      return;
    }
    if (order.status === OrderStatus.PAID) {
      response.status(200).json({ received: true, duplicate: true });
      return;
    }
    if (order.status !== OrderStatus.PENDING) {
      if (order.status === OrderStatus.FAILED) {
        await refundPaystackPayment(order.paymentReference!);
        await prisma.ticketOrder.update({
          where: { id: order.id, status: OrderStatus.FAILED },
          data: { status: OrderStatus.REFUNDED },
        });
        response.status(200).json({ received: true, refunded: true });
        return;
      }
      response.status(200).json({ received: true, ignored: true });
      return;
    }
    if (order.expiresAt <= new Date()) {
      const expired = await prisma.$transaction(async (transaction) => {
        const update = await transaction.ticketOrder.updateMany({
          where: { id: order.id, status: OrderStatus.PENDING },
          data: { status: OrderStatus.FAILED },
        });
        if (update.count !== 1) return false;
        const tier = await transaction.ticketTier.updateMany({
          where: { id: order.ticketTierId, sold: { gte: order.quantity } },
          data: { sold: { decrement: order.quantity } },
        });
        if (tier.count !== 1) throw new Error(`Ticket reservation invariant failed for order ${order.id}`);
        return true;
      });
      if (expired) {
        await refundPaystackPayment(order.paymentReference!);
        await prisma.ticketOrder.update({
          where: { id: order.id, status: OrderStatus.FAILED },
          data: { status: OrderStatus.REFUNDED },
        });
        response.status(200).json({ received: true, refunded: true });
        return;
      }
      const current = await prisma.ticketOrder.findUnique({ where: { id: order.id }, select: { status: true } });
      if (current?.status === OrderStatus.PAID) {
        response.status(200).json({ received: true, duplicate: true });
        return;
      }
      await refundPaystackPayment(order.paymentReference!);
      if (current?.status === OrderStatus.FAILED) {
        await prisma.ticketOrder.update({
          where: { id: order.id, status: OrderStatus.FAILED },
          data: { status: OrderStatus.REFUNDED },
        });
      }
      response.status(200).json({ received: true, refunded: true });
      return;
    }

    const passTokens = Array.from({ length: order.quantity }, () => createOpaqueToken());
    const generated = await Promise.allSettled(
      passTokens.map((token) => createPassQr(order.eventId, token)),
    );
    const objectKeys = generated.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const generationFailure = generated.find((result) => result.status === "rejected");
    if (generationFailure?.status === "rejected") {
      await removeOrphanedPasses(objectKeys);
      throw generationFailure.reason;
    }
    try {
      const fulfilled = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.ticketOrder.updateMany({
          where: { id: order.id, status: OrderStatus.PENDING },
          data: { status: OrderStatus.PAID, paidAt: new Date() },
        });
        if (updated.count !== 1) {
          return false;
        }
        await transaction.ticket.createMany({
          data: passTokens.map((token, index) => ({
            orderId: order.id,
            passTokenHash: hashOpaqueToken(token),
            qrObjectKey: objectKeys[index],
          })),
        });
        return true;
      });
      if (!fulfilled) {
        await removeOrphanedPasses(objectKeys);
        const current = await prisma.ticketOrder.findUnique({
          where: { id: order.id },
          select: { status: true },
        });
        if (current?.status === OrderStatus.FAILED) {
          await refundPaystackPayment(order.paymentReference!);
          await prisma.ticketOrder.update({
            where: { id: order.id, status: OrderStatus.FAILED },
            data: { status: OrderStatus.REFUNDED },
          });
          response.status(200).json({ received: true, refunded: true });
          return;
        }
        response.status(200).json({ received: true, duplicate: true });
        return;
      }
    } catch (error) {
      console.error("Could not fulfill Paystack order", { orderId: order.id, error });
      throw error;
    }
    await incrementPromoRedemption(order.eventId, webhook.data.metadata?.promoCode);

    const links = passTokens
      .map((token, index) => `${index + 1}: ${config.WEB_ORIGIN}/pass/${token}`)
      .join(" ");
    const sms = await sendEventSms(
      order.eventId,
      order.purchaserPhone,
      `Payment confirmed for ${order.event.title}. Your ticket pass${passTokens.length === 1 ? "" : "es"}: ${links}`,
    );
    response.status(200).json({ received: true, smsStatus: sms.status });
  }),
);

webhooksRouter.post(
  "/moolre",
  asyncHandler(async (request, response) => {
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({ error: "Expected raw webhook body" });
      return;
    }
    if (!config.MOOLRE_CALLBACK_SECRET) {
      response.status(503).json({ error: "Moolre callback verification is not configured" });
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(request.body.toString("utf8"));
    } catch {
      response.status(400).json({ error: "Invalid webhook JSON" });
      return;
    }
    const parsed = moolreCallbackSchema.safeParse(payload);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid Moolre callback payload" });
      return;
    }
    const callback = parsed.data;
    const secret = callback.secret ?? callback.callback_secret;
    if (!matchesCallbackSecret(secret, config.MOOLRE_CALLBACK_SECRET)) {
      response.status(401).json({ error: "Invalid Moolre callback secret" });
      return;
    }

    const fields = {
      status: callback.data?.status ?? callback.status,
      code: callback.data?.code ?? callback.code,
      reference: callback.data?.externalref ?? callback.externalref,
      transactionId: callback.data?.transactionid ?? callback.transactionid,
      accountNumber: callback.data?.accountnumber ?? callback.accountnumber,
      amount: callback.data?.amount ?? callback.amount,
      currency: callback.data?.currency ?? callback.currency,
    };
    if (!fields.reference || fields.amount === undefined || !fields.accountNumber || !fields.currency) {
      response.status(400).json({ error: "Moolre callback is missing required payment details" });
      return;
    }
    const invoice = await prisma.subscriptionInvoice.findUnique({
      where: { reference: fields.reference },
    });
    if (!invoice || invoice.provider !== BillingProvider.MOOLRE) {
      response.status(200).json({ received: true, ignored: true });
      return;
    }
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(fields.amount);
    } catch {
      response.status(400).json({ error: "Invalid Moolre payment amount" });
      return;
    }
    if (
      fields.accountNumber !== config.MOOLRE_ACCOUNT_NUMBER ||
      amount.comparedTo(invoice.amount) !== 0 ||
      fields.currency.toUpperCase() !== invoice.currency
    ) {
      response.status(400).json({ error: "Moolre payment details do not match the subscription invoice" });
      return;
    }

    const status = String(fields.status).toLowerCase();
    const successful = ["success", "successful", "completed", "paid"].includes(status) &&
      ["P01", "P02"].includes((fields.code ?? "").toUpperCase());
    if (!successful) {
      if (["failed", "failure", "declined"].includes(status)) {
        await failSubscriptionInvoice(invoice.reference, BillingProvider.MOOLRE);
      }
      response.status(200).json({ received: true });
      return;
    }
    if (fields.transactionId === undefined || !String(fields.transactionId).trim()) {
      response.status(400).json({ error: "Moolre callback is missing the transaction ID" });
      return;
    }
    const activation = await activateSubscriptionInvoice(invoice.id, String(fields.transactionId));
    response.status(200).json({ received: true, subscription: activation });
  }),
);
