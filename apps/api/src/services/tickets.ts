import { OrderStatus } from "@prisma/client";
import { prisma } from "../db.js";

export async function expirePendingTicketOrders(now = new Date()): Promise<number> {
  const expired = await prisma.ticketOrder.findMany({
    where: { status: OrderStatus.PENDING, expiresAt: { lte: now } },
    select: { id: true, ticketTierId: true, quantity: true },
    take: 500,
  });
  let released = 0;
  for (const order of expired) {
    const changed = await prisma.$transaction(async (transaction) => {
      const update = await transaction.ticketOrder.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING, expiresAt: { lte: now } },
        data: { status: OrderStatus.FAILED },
      });
      if (update.count !== 1) return false;
      const tier = await transaction.ticketTier.updateMany({
        where: { id: order.ticketTierId, sold: { gte: order.quantity } },
        data: { sold: { decrement: order.quantity } },
      });
      if (tier.count !== 1) {
        throw new Error(`Ticket reservation invariant failed for order ${order.id}`);
      }
      return true;
    });
    if (changed) released += 1;
  }
  return released;
}

