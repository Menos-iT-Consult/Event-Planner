import { createHmac } from "node:crypto";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { hashOpaqueToken } from "../lib/tokens.js";
import { sendEventSms } from "./messaging.js";

function hashPhone(eventId: string, phone: string): string {
  return createHmac("sha256", config.JWT_SECRET)
    .update(`${eventId}:${phone}`)
    .digest("hex");
}

function createOptOutToken(eventId: string, phoneHash: string): string {
  return createHmac("sha256", config.JWT_SECRET)
    .update(`sms-opt-out:${eventId}:${phoneHash}`)
    .digest("base64url");
}

export async function getSmsPreference(eventId: string, phone: string) {
  const phoneHash = hashPhone(eventId, phone);
  const optOutToken = createOptOutToken(eventId, phoneHash);
  const preference = await prisma.smsPreference.upsert({
    where: { eventId_phoneHash: { eventId, phoneHash } },
    create: { eventId, phoneHash, optOutTokenHash: hashOpaqueToken(optOutToken) },
    update: {},
    select: { optedOutAt: true },
  });
  return {
    optedOut: preference.optedOutAt !== null,
    optOutUrl: `${config.WEB_ORIGIN}/sms-opt-out?token=${encodeURIComponent(optOutToken)}`,
  };
}

export async function optOutSms(token: string): Promise<boolean> {
  const preference = await prisma.smsPreference.findUnique({
    where: { optOutTokenHash: hashOpaqueToken(token) },
    select: { id: true },
  });
  if (!preference) return false;
  await prisma.smsPreference.updateMany({
    where: { id: preference.id, optedOutAt: null },
    data: { optedOutAt: new Date() },
  });
  return true;
}

export async function sendBroadcastSms(
  eventId: string,
  phone: string,
  message: string,
): Promise<"SENT" | "FAILED" | "OPTED_OUT"> {
  const preference = await getSmsPreference(eventId, phone);
  if (preference.optedOut) return "OPTED_OUT";
  const result = await sendEventSms(
    eventId,
    phone,
    `${message}\n\nStop event texts: ${preference.optOutUrl}`,
  );
  return result.status === "SENT" ? "SENT" : "FAILED";
}
