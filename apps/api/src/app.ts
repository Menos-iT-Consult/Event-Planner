import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { eventsRouter } from "./routes/events.js";
import { publicRouter } from "./routes/public.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { errorHandler, notFound } from "./middleware/errors.js";

export const app = express();
export default app;

app.disable("x-powered-by");
app.use(helmet());
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

app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "eventflow-api" });
});

app.use(
  "/api/webhooks",
  express.raw({ type: "application/json", limit: "1mb" }),
  webhooksRouter,
);
app.use(express.json({ limit: "1mb" }));

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/events", eventsRouter);
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

app.use(notFound);
app.use(errorHandler);
