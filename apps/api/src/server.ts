import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { expirePendingTicketOrders } from "./services/tickets.js";
import { runBackgroundJobs } from "./services/workers.js";
import { collectProviderHealth } from "./services/health.js";
import { logEvent } from "./lib/logger.js";

const server = app.listen(config.PORT, () => {
  logEvent("info", "server.started", { port: config.PORT, environment: config.NODE_ENV });
  void expirePendingTicketOrders()
    .then((count) => {
      if (count > 0) logEvent("info", "ticket_reservations.expired", { count });
    })
    .catch((error: unknown) => logEvent("error", "ticket_reservations.expiry_failed", { error }));
  void runBackgroundJobs()
    .then((count) => {
      if (count > 0) logEvent("info", "background_jobs.run_completed", { count });
    })
    .catch((error: unknown) => logEvent("error", "background_jobs.run_failed", { error }));
  void collectProviderHealth();
});
const ticketExpiryInterval = setInterval(() => {
  void expirePendingTicketOrders()
    .then((count) => {
      if (count > 0) logEvent("info", "ticket_reservations.expired", { count });
    })
    .catch((error: unknown) => logEvent("error", "ticket_reservations.expiry_failed", { error }));
}, 60_000);
const workerInterval = setInterval(() => {
  void runBackgroundJobs()
    .then((count) => {
      if (count > 0) logEvent("info", "background_jobs.run_completed", { count });
    })
    .catch((error: unknown) => logEvent("error", "background_jobs.run_failed", { error }));
}, 60_000);
const providerHealthInterval = setInterval(() => {
  void collectProviderHealth().catch((error: unknown) => logEvent("error", "provider.health_run_failed", { error }));
}, 5 * 60_000);

async function shutdown(signal: string): Promise<void> {
  logEvent("info", "server.shutdown_started", { signal });
  clearInterval(ticketExpiryInterval);
  clearInterval(workerInterval);
  clearInterval(providerHealthInterval);
  server.close(async (error) => {
    if (error) {
      logEvent("error", "server.shutdown_failed", { error });
      process.exitCode = 1;
    }
    await prisma.$disconnect();
    process.exit();
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
