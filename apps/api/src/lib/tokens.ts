import { createHash, createHmac, randomBytes } from "node:crypto";
import { config } from "../config.js";

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashVoterIdentity(identity: string, eventId: string): string {
  return createHmac("sha256", config.JWT_SECRET)
    .update(`${eventId}:${identity.trim().toLowerCase()}`)
    .digest("hex");
}

