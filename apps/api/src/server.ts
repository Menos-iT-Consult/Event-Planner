import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { expirePendingTicketOrders } from "./services/tickets.js";

const server = app.listen(config.PORT, () => {
  console.log(`EventFlow API listening on port ${config.PORT}`);
  void expirePendingTicketOrders()
    .then((count) => {
      if (count > 0) console.log(`Released ${count} expired ticket reservations`);
    })
    .catch((error: unknown) => console.error("Could not release expired ticket reservations", error));
});
const ticketExpiryInterval = setInterval(() => {
  void expirePendingTicketOrders()
    .then((count) => {
      if (count > 0) console.log(`Released ${count} expired ticket reservations`);
    })
    .catch((error: unknown) => console.error("Could not release expired ticket reservations", error));
}, 60_000);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received; shutting down EventFlow API`);
  clearInterval(ticketExpiryInterval);
  server.close(async (error) => {
    if (error) {
      console.error("HTTP server shutdown failed", error);
      process.exitCode = 1;
    }
    await prisma.$disconnect();
    process.exit();
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
