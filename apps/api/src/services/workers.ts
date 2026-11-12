import nodemailer from "nodemailer";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { sendEventSms } from "./messaging.js";
import { uploadPrivateObject } from "./storage.js";
import { logEvent } from "../lib/logger.js";
import { sendBroadcastSms } from "./sms-preferences.js";

const BACKGROUND_JOB_STALE_AFTER_MS = 60 * 60 * 1000;
const BACKGROUND_JOB_HEARTBEAT_MS = 10 * 60 * 1000;

async function sendScheduledSms(scheduleId: string): Promise<void> {
  const schedule = await prisma.eventMessageSchedule.findUnique({
    where: { id: scheduleId },
    include: { event: { select: { title: true } } },
  });
  if (!schedule) throw new Error("Scheduled message was not found");
  if (schedule.status === "SENDING") {
    await prisma.eventMessageSchedule.update({
      where: { id: schedule.id },
      data: {
        status: "FAILED",
        error: "Previous send attempt was interrupted; automatic resend was prevented",
      },
    });
    return;
  }
  if (schedule.status !== "SCHEDULED") return;
  const claimed = await prisma.eventMessageSchedule.updateMany({
    where: { id: schedule.id, status: "SCHEDULED" },
    data: { status: "SENDING", error: null },
  });
  if (claimed.count !== 1) return;

  let cursor: string | undefined;
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const seenPhones = new Set<string>();
  try {
    while (true) {
      const guests = await prisma.guest.findMany({
        where: {
          eventId: schedule.eventId,
          status: schedule.audience === "ATTENDING" ? "ATTENDING" : undefined,
        },
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: 200,
        select: { id: true, name: true, phone: true },
      });
      if (!guests.length) break;
      cursor = guests[guests.length - 1]!.id;
      const recipients = guests.filter((guest) => {
        if (seenPhones.has(guest.phone)) return false;
        seenPhones.add(guest.phone);
        return true;
      });
      for (let index = 0; index < recipients.length; index += 10) {
        const batch = recipients.slice(index, index + 10);
        const results = await Promise.all(batch.map((guest) =>
          sendBroadcastSms(
            schedule.eventId,
            guest.phone,
            schedule.message
              .replaceAll("{name}", guest.name)
              .replaceAll("{event}", schedule.event.title),
          ),
        ));
        sentCount += results.filter((result) => result === "SENT").length;
        failedCount += results.filter((result) => result === "FAILED").length;
        skippedCount += results.filter((result) => result === "OPTED_OUT").length;
      }
      if (guests.length < 200) break;
    }

    await prisma.eventMessageSchedule.update({
      where: { id: schedule.id },
      data: {
        status: failedCount > 0 ? "FAILED" : "SENT",
        sentCount,
        failedCount,
        skippedCount,
        sentAt: new Date(),
        error: failedCount > 0 ? `${failedCount} SMS delivery attempt(s) failed; no automatic resend was attempted` : null,
      },
    });
  } catch (error) {
    await prisma.eventMessageSchedule.update({
      where: { id: schedule.id },
      data: {
        status: "FAILED",
        sentCount,
        failedCount,
        skippedCount,
        sentAt: new Date(),
        error: "Scheduled send was interrupted; automatic resend was prevented",
      },
    });
    throw error;
  }
  logEvent(failedCount > 0 ? "warn" : "info", "scheduled_sms.completed", {
    scheduleId,
    eventId: schedule.eventId,
    sentCount,
    failedCount,
    skippedCount,
  });
}

export async function runBackgroundJobs(limit = 10): Promise<number> {
  const staleJobs = await prisma.backgroundJob.updateMany({
    where: {
      status: "RUNNING",
      OR: [{ startedAt: null }, { startedAt: { lte: new Date(Date.now() - BACKGROUND_JOB_STALE_AFTER_MS) } }],
    },
    data: {
      status: "DEAD",
      completedAt: new Date(),
      error: "Worker lease expired before completion; verify external effects before retrying",
    },
  });
  if (staleJobs.count > 0) {
    logEvent("warn", "background_job.stale_recovered", { count: staleJobs.count });
  }

  const jobs = await prisma.backgroundJob.findMany({
    where: { status: { in: ["QUEUED", "FAILED"] }, runAt: { lte: new Date() } },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  let completed = 0;
  for (const job of jobs) {
    if (job.attempts >= job.maxAttempts) {
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: { status: "DEAD", completedAt: new Date(), error: "Maximum attempts reached" },
      });
      logEvent("error", "background_job.dead", { jobId: job.id, type: job.type, attempts: job.attempts });
      continue;
    }

    const claimed = await prisma.backgroundJob.updateMany({
      where: { id: job.id, status: { in: ["QUEUED", "FAILED"] } },
      data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date(), error: null },
    });
    if (claimed.count !== 1) continue;

    const heartbeat = setInterval(() => {
      void prisma.backgroundJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: { startedAt: new Date() },
      }).catch((error: unknown) => {
        logEvent("error", "background_job.heartbeat_failed", { jobId: job.id, error });
      });
    }, BACKGROUND_JOB_HEARTBEAT_MS);
    heartbeat.unref();

    try {
      if (job.type === "SEND_EMAIL") {
        const payload = job.payload as { to?: string; subject?: string; text?: string };
        if (!config.SMTP_HOST) throw new Error("SMTP email delivery is not configured");
        if (!payload.to || !payload.subject || !payload.text) {
          throw new Error("Email delivery payload is incomplete");
        }
        const transporter = nodemailer.createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          ...(config.SMTP_USER && config.SMTP_PASS
            ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
            : {}),
        });
        await transporter.sendMail({
          from: config.EMAIL_FROM ?? config.SMTP_USER ?? "EventFlow <noreply@example.com>",
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
        });
      } else if (job.type === "ISSUE_CERTIFICATE") {
        const payload = job.payload as { certificateId?: string };
        if (!payload.certificateId) throw new Error("Certificate ID is missing");
        const certificate = await prisma.certificate.findUnique({
          where: { id: payload.certificateId },
          include: { event: { select: { title: true } } },
        });
        if (!certificate) throw new Error("Certificate not found");
        const escapeXml = (value: string) => value
          .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850"><rect width="1200" height="850" fill="#fff"/><rect x="30" y="30" width="1140" height="790" fill="none" stroke="#2563eb" stroke-width="8"/><text x="600" y="220" text-anchor="middle" font-family="Arial" font-size="54" fill="#172554">Certificate of Attendance</text><text x="600" y="420" text-anchor="middle" font-family="Arial" font-size="48" fill="#111827">${escapeXml(certificate.recipientName)}</text><text x="600" y="520" text-anchor="middle" font-family="Arial" font-size="34" fill="#374151">${escapeXml(certificate.title)}</text><text x="600" y="610" text-anchor="middle" font-family="Arial" font-size="30" fill="#374151">${escapeXml(certificate.event.title)}</text></svg>`;
        const objectKey = certificate.objectKey ?? `events/${certificate.eventId}/certificates/${certificate.id}.svg`;
        await uploadPrivateObject(objectKey, Buffer.from(svg), "image/svg+xml");
        await prisma.certificate.update({
          where: { id: certificate.id },
          data: { objectKey },
        });
      } else if (job.type === "WAITLIST_NOTIFICATION") {
        const payload = job.payload as { eventId?: string; phone?: string; message?: string };
        if (!payload.eventId || !payload.phone || !payload.message) {
          throw new Error("Waitlist notification payload is incomplete");
        }
        const result = await sendEventSms(payload.eventId, payload.phone, payload.message);
        if (result.status !== "SENT") throw new Error(result.error ?? "Waitlist SMS delivery failed");
      } else if (job.type === "SEND_SCHEDULED_SMS") {
        const payload = job.payload as { scheduleId?: string };
        if (!payload.scheduleId) throw new Error("Scheduled message ID is missing");
        await sendScheduledSms(payload.scheduleId);
      } else {
        throw new Error(`Unsupported background job type: ${job.type}`);
      }

      const completedJob = await prisma.backgroundJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: { status: "COMPLETED", completedAt: new Date(), error: null },
      });
      if (completedJob.count !== 1) {
        logEvent("error", "background_job.lease_lost", { jobId: job.id, type: job.type });
        continue;
      }
      logEvent("info", "background_job.completed", { jobId: job.id, type: job.type });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      const dead = job.attempts + 1 >= job.maxAttempts;
      const failedJob = await prisma.backgroundJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: dead ? "DEAD" : "FAILED",
          error: message,
          runAt: new Date(Date.now() + Math.min(60_000 * 2 ** job.attempts, 3_600_000)),
          completedAt: dead ? new Date() : null,
        },
      });
      if (failedJob.count !== 1) {
        logEvent("error", "background_job.lease_lost", { jobId: job.id, type: job.type, error });
        continue;
      }
      logEvent(dead ? "error" : "warn", dead ? "background_job.dead" : "background_job.retry_scheduled", {
        jobId: job.id,
        type: job.type,
        attempt: job.attempts + 1,
        error,
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
  return completed;
}
