import { config } from "../config.js";
import { prisma } from "../db.js";
import { logEvent } from "../lib/logger.js";

type ProviderStatus = "ready" | "not_configured" | "unavailable";
type ProviderCheck = { provider: string; status: ProviderStatus; details: string };

function providerChecks(databaseStatus: ProviderStatus): ProviderCheck[] {
  const hasR2 = Boolean(
    config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY && config.R2_BUCKET_NAME,
  );
  const hasSmtp = Boolean(config.SMTP_HOST);
  const hasMoolre = Boolean(
    config.MOOLRE_API_USER &&
    config.MOOLRE_API_PUBKEY &&
    config.MOOLRE_ACCOUNT_NUMBER &&
    config.MOOLRE_BILLING_EMAIL &&
    config.MOOLRE_CALLBACK_SECRET
  );
  const hasOidc = Boolean(config.OIDC_ISSUER && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET);
  return [
    { provider: "database", status: databaseStatus, details: "Database connectivity check" },
    { provider: "sms", status: config.MNOTIFY_API_KEY ? "ready" : "not_configured", details: "mNotify credentials configured" },
    { provider: "payments", status: config.PAYSTACK_SECRET_KEY || hasMoolre ? "ready" : "not_configured", details: "At least one subscription or event payment provider is configured" },
    { provider: "moolre", status: hasMoolre ? "ready" : "not_configured", details: "Moolre credentials and callback verification configured" },
    { provider: "oidc", status: hasOidc ? "ready" : "not_configured", details: "OIDC issuer and client credentials configured" },
    { provider: "objectStorage", status: hasR2 ? "ready" : "not_configured", details: "Cloudflare R2 credentials configured" },
    { provider: "email", status: hasSmtp ? "ready" : "not_configured", details: "SMTP credentials configured" },
  ];
}

export async function collectProviderHealth(): Promise<Record<string, string>> {
  let databaseStatus: ProviderStatus = "ready";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    databaseStatus = "unavailable";
    logEvent("error", "provider.health_check_failed", { provider: "database", error });
  }

  const checks = providerChecks(databaseStatus);
  if (databaseStatus === "ready") {
    try {
      await prisma.providerHealthCheck.createMany({
        data: checks.map(({ provider, status, details }) => ({ provider, status, details })),
      });
    } catch (error) {
      logEvent("error", "provider.health_history_write_failed", { error });
    }
  }
  return Object.fromEntries(checks.map(({ provider, status }) => [provider, status]));
}

export async function getProviderHealthHistory(limitPerProvider = 5) {
  const checks = await prisma.providerHealthCheck.findMany({
    orderBy: { checkedAt: "desc" },
    take: Math.max(5, Math.min(50, limitPerProvider * 5)),
    select: { provider: true, status: true, details: true, checkedAt: true },
  });
  const history = new Map<string, typeof checks>();
  for (const check of checks) {
    const records = history.get(check.provider) ?? [];
    if (records.length < limitPerProvider) records.push(check);
    history.set(check.provider, records);
  }
  return Object.fromEntries(history);
}
