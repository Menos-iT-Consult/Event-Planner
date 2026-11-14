import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const envFile = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", "..", ".env")]
  .find((path) => existsSync(path));
if (envFile) loadEnv({ path: envFile });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  API_ORIGIN: z.string().url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
  JWT_EXPIRES_IN: z.string().regex(/^[1-9]\d*(s|m|h|d)$/).default("8h"),
  COOKIE_SECURE: z.enum(["true", "false"]).transform((value) => value === "true").default("false"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  MNOTIFY_API_KEY: z.string().optional(),
  MNOTIFY_SENDER_ID: z.string().max(11).default("EventFlow"),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_CALLBACK_URL: z.string().url().default("http://localhost:5173/payment/return"),
  MOOLRE_API_USER: z.string().optional(),
  MOOLRE_API_PUBKEY: z.string().optional(),
  MOOLRE_ACCOUNT_NUMBER: z.string().optional(),
  MOOLRE_BILLING_EMAIL: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().email().optional(),
  ),
  MOOLRE_CALLBACK_SECRET: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(32).optional(),
  ),
  MOOLRE_API_ORIGIN: z.string().url().default("https://api.moolre.com"),
  OIDC_ISSUER: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().url().optional(),
  ),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_ALLOWED_EMAIL_DOMAINS: z.string().optional(),
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).transform((value) => value === "true").default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().trim().min(1).optional(),
});

export const config = envSchema.parse(process.env);
if (config.NODE_ENV === "production" && !config.COOKIE_SECURE) {
  throw new Error("COOKIE_SECURE=true is required in production");
}
if (
  config.NODE_ENV === "production" &&
  (!config.WEB_ORIGIN.startsWith("https://") || !config.API_ORIGIN.startsWith("https://"))
) {
  throw new Error("WEB_ORIGIN and API_ORIGIN must use HTTPS in production");
}
