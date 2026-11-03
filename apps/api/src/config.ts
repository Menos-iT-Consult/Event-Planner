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
  JWT_EXPIRES_IN: z.string().default("8h"),
  COOKIE_SECURE: z.enum(["true", "false"]).transform((value) => value === "true").default("false"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  WEDDING_DAILY_RATE: z.coerce.number().nonnegative().max(9_999_999_999.99).refine(hasTwoDecimalPlaces).default(100),
  VOTING_DAILY_RATE: z.coerce.number().nonnegative().max(9_999_999_999.99).refine(hasTwoDecimalPlaces).default(150),
  GENERAL_DAILY_RATE: z.coerce.number().nonnegative().max(9_999_999_999.99).refine(hasTwoDecimalPlaces).default(125),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  MNOTIFY_API_KEY: z.string().optional(),
  MNOTIFY_SENDER_ID: z.string().max(11).default("EventFlow"),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_CALLBACK_URL: z.string().url().default("http://localhost:5173/payment/return"),
});

function hasTwoDecimalPlaces(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

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
