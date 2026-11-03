import { Router } from "express";
import { OrderStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { createOpaqueToken, hashOpaqueToken } from "../lib/tokens.js";
import { createPassQr } from "../services/passes.js";
import { sendEventSms } from "../services/messaging.js";
import { refundPaystackPayment, verifyPaystackSignature } from "../services/payments.js";
import { deletePrivateObject } from "../services/storage.js";

const webhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string(),
    status: z.string(),
    amount: z.number().int().nonnegative(),
    currency: z.string(),
  }),
});

export const webhooksRouter = Router();

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
    if (webhook.event !== "charge.success" || webhook.data.status !== "success") {
      response.status(200).json({ received: true });
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
          data: { status: OrderStatus.PAID },
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
          data: { status: OrderStatus.PAID },
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
