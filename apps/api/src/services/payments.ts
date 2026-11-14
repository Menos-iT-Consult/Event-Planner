import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: { authorization_url?: string; access_code?: string; reference?: string };
}

interface MoolrePaymentLinkResponse {
  status: number | string;
  code?: string;
  message?: string | null;
  data?: { authorization_url?: string; reference?: string };
}

export async function initializeMoolrePayment(input: {
  amount: string;
  reference: string;
  metadata: Record<string, string | number>;
}): Promise<{ authorizationUrl: string; reference: string }> {
  if (
    !config.MOOLRE_API_USER ||
    !config.MOOLRE_API_PUBKEY ||
    !config.MOOLRE_ACCOUNT_NUMBER ||
    !config.MOOLRE_BILLING_EMAIL
  ) {
    throw new Error("Moolre billing is not configured");
  }
  const response = await fetch(`${config.MOOLRE_API_ORIGIN}/embed/link`, {
    method: "POST",
    headers: {
      "X-API-USER": config.MOOLRE_API_USER,
      "X-API-PUBKEY": config.MOOLRE_API_PUBKEY,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      type: 1,
      amount: input.amount,
      email: config.MOOLRE_BILLING_EMAIL,
      externalref: input.reference,
      callback: `${config.API_ORIGIN}/api/webhooks/moolre`,
      redirect: `${config.WEB_ORIGIN}/organizations?subscription=${encodeURIComponent(input.reference)}`,
      reusable: "0",
      expiration_time: 60,
      currency: "GHS",
      accountnumber: config.MOOLRE_ACCOUNT_NUMBER,
      metadata: input.metadata,
    }),
  });
  const result = await response.json() as MoolrePaymentLinkResponse;
  if (!response.ok || String(result.status) !== "1" || !result.data?.authorization_url) {
    throw new Error(`Moolre payment initialization failed: ${result.message ?? response.statusText}`);
  }
  return {
    authorizationUrl: result.data.authorization_url,
    reference: result.data.reference ?? input.reference,
  };
}

export async function initializePaystackPayment(input: {
  email: string;
  amountMinor: number;
  reference: string;
  metadata: Record<string, string | number>;
}): Promise<{ authorizationUrl: string; reference: string }> {
  if (!config.PAYSTACK_SECRET_KEY) {
    throw new Error("Paystack is not configured");
  }
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      email: input.email,
      amount: input.amountMinor,
      currency: "GHS",
      reference: input.reference,
      callback_url: config.PAYSTACK_CALLBACK_URL,
      metadata: input.metadata,
    }),
  });
  const result = (await response.json()) as PaystackInitializeResponse;
  if (!response.ok || !result.status || !result.data?.authorization_url) {
    throw new Error(`Paystack initialization failed: ${result.message ?? response.statusText}`);
  }
  return {
    authorizationUrl: result.data.authorization_url,
    reference: result.data.reference ?? input.reference,
  };
}

export async function refundPaystackPayment(reference: string): Promise<void> {
  if (!config.PAYSTACK_SECRET_KEY) {
    throw new Error("Paystack is not configured");
  }
  const response = await fetch("https://api.paystack.co/refund", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ transaction: reference }),
  });
  const result = await response.json() as { status?: boolean; message?: string };
  if (!response.ok || !result.status) {
    throw new Error(`Paystack refund failed: ${result.message ?? response.statusText}`);
  }
}

export function verifyPaystackSignature(
  rawBody: Buffer,
  receivedSignature: string | undefined,
): boolean {
  if (!config.PAYSTACK_SECRET_KEY || !receivedSignature) {
    return false;
  }
  const expected = createHmac("sha512", config.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(receivedSignature, "hex");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
