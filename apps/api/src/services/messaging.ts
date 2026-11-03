const SmsStatus = {
  QUEUED: "QUEUED",
  FAILED: "FAILED",
  SENT: "SENT",
} as const;

type SmsStatus = (typeof SmsStatus)[keyof typeof SmsStatus];
import { config } from "../config.js";
import { prisma } from "../db.js";
import { redactPrivateLinks } from "../lib/redact.js";

interface MnotifyResponse {
  status?: string;
  code?: string;
  message?: string;
}

export async function sendEventSms(
  eventId: string,
  recipient: string,
  message: string,
): Promise<{ status: SmsStatus; error?: string }> {
  const log = await prisma.smsLog.create({
    data: { eventId, recipient, message: redactPrivateLinks(message), status: SmsStatus.QUEUED },
  });

  if (!config.MNOTIFY_API_KEY) {
    const error = "mNotify is not configured";
    await prisma.smsLog.update({
      where: { id: log.id },
      data: { status: SmsStatus.FAILED, error },
    });
    return { status: SmsStatus.FAILED, error };
  }

  try {
    const url = new URL("https://api.mnotify.com/api/sms/quick");
    url.searchParams.set("key", config.MNOTIFY_API_KEY);
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        recipient: [recipient],
        sender: config.MNOTIFY_SENDER_ID,
        message,
        is_schedule: false,
        schedule_date: "",
      }),
    });
    const result = (await response.json().catch(() => ({}))) as MnotifyResponse;

    if (!response.ok) {
      const error = `mNotify returned HTTP ${response.status}`;
      await prisma.smsLog.update({
        where: { id: log.id },
        data: { status: SmsStatus.FAILED, error },
      });
      return { status: SmsStatus.FAILED, error };
    }

    const providerStatus = String(result.status ?? "").toLowerCase();
    const providerCode = String(result.code ?? "").toLowerCase();
    const accepted =
      ["success", "sent"].includes(providerStatus) ||
      ["200", "2000"].includes(providerCode);
    if (!accepted) {
      const error = result.message ?? "mNotify rejected the message";
      await prisma.smsLog.update({
        where: { id: log.id },
        data: { status: SmsStatus.FAILED, error },
      });
      return { status: SmsStatus.FAILED, error };
    }

    await prisma.smsLog.update({
      where: { id: log.id },
      data: {
        status: SmsStatus.SENT,
        sentAt: new Date(),
        providerRef: result.code,
      },
    });
    return { status: SmsStatus.SENT };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown mNotify error";
    await prisma.smsLog.update({
      where: { id: log.id },
      data: { status: SmsStatus.FAILED, error: message },
    });
    return { status: SmsStatus.FAILED, error: message };
  }
}
