import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { uploadPrivateObject } from "./storage.js";

export async function createPassQr(
  eventId: string,
  token: string,
): Promise<string> {
  const png = await QRCode.toBuffer(`${config.WEB_ORIGIN}/pass/${token}`, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
  });
  const key = `events/${eventId}/passes/${randomUUID()}.png`;
  await uploadPrivateObject(key, png, "image/png");
  return key;
}
