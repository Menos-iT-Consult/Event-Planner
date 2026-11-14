import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { eventsRouter } from "./routes/events.js";
import { organizationsRouter } from "./routes/organizations.js";
import { subscriptionsRouter } from "./routes/subscriptions.js";
import { weddingRouter } from "./routes/wedding.js";
import { publicRouter } from "./routes/public.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { prisma } from "./db.js";
import { featuresAdminRouter, featuresEventRouter, featuresPublicRouter } from "./routes/features.js";
import { createRequestId, logEvent } from "./lib/logger.js";
import type { AuthenticatedRequest } from "./middleware/auth.js";

export const app = express();
export default app;

app.disable("x-powered-by");
app.use(helmet());
app.use((request, response, next) => {
  const requestId = createRequestId();
  const startedAt = performance.now();
  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  response.on("finish", () => {
    const route = request.route?.path;
    logEvent("info", "http.request", {
      requestId,
      method: request.method,
      route: route ? `${request.baseUrl}${String(route)}` : "unmatched",
      status: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    });
    if (
      request.originalUrl.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      response.statusCode < 400
    ) {
      const authenticated = request as AuthenticatedRequest;
      const eventId = response.locals.eventId as string | undefined;
      const organizationId = response.locals.organizationId as string | undefined;
      const entityType = eventId ? "event" : organizationId ? "organization" : "api_request";
      const entityId = eventId ?? organizationId;
      const action = `${request.method} ${request.baseUrl}${route ? String(route) : "unmatched"}`;
      void prisma.auditLog.create({
        data: {
          actorId: authenticated.user?.id,
          organizationId,
          eventId,
          action,
          entityType,
          entityId,
          metadata: {
            requestId,
            status: response.statusCode,
          },
        },
      }).catch((error: unknown) => {
        logEvent("error", "audit.write_failed", { requestId, action, error });
      });
    }
  });
  next();
});
app.use(cors({
  origin: config.WEB_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.use((request, response, next) => {
  const origin = request.header("origin");
  if (origin && origin !== config.WEB_ORIGIN) {
    response.status(403).json({ error: "Origin is not allowed" });
    return;
  }
  next();
});
app.use(cookieParser());

const readinessHandler = async (_request: express.Request, response: express.Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: "ok", service: "eventflow-api", database: "ok" });
  } catch (error: unknown) {
    logEvent("error", "health.readiness_failed", { error, requestId: response.locals.requestId });
    response.status(503).json({
      status: "error",
      service: "eventflow-api",
      database: "unavailable",
    });
  }
};
app.get("/health/live", (_request, response) => {
  response.json({ status: "ok", service: "eventflow-api" });
});
app.get("/health/ready", readinessHandler);
app.get("/health", readinessHandler);

app.use(
  "/api/webhooks",
  express.raw({ type: "application/json", limit: "1mb" }),
  webhooksRouter,
);
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/features", featuresAdminRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/events", weddingRouter);
app.use("/api/events", featuresEventRouter);
app.use(
  "/api/public",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
  publicRouter,
);
app.use(
  "/api/public/features",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
  featuresPublicRouter,
);

app.use(notFound);
app.use(errorHandler);
