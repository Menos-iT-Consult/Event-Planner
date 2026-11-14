import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const prefix = "enc:v1:";
const aad = Buffer.from("eventflow-secret-v1");

export function encryptText(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${prefix}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptText(value: string, key: Buffer): string {
  if (!value.startsWith(prefix)) return value;
  const [ivValue, tagValue, ciphertextValue, extra] = value.slice(prefix.length).split(".");
  if (!ivValue || !tagValue || !ciphertextValue || extra !== undefined) {
    throw new Error("Stored secret has an invalid encrypted format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
