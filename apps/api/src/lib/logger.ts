import { randomUUID } from "node:crypto";
import { redactPrivateLinks } from "./redact.js";

type LogLevel = "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const sensitiveField = /(authorization|cookie|secret|password|token|phone|email|recipient|message|payload|body|query|ipaddress)/i;
const sensitiveValue = /((?:token|password|secret|authorization)=)[^\s&]+/gi;

function safeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactPrivateLinks(value.message).replace(sensitiveValue, "$1[REDACTED]"),
    };
  }
  if (typeof value === "string") {
    return redactPrivateLinks(value).replace(sensitiveValue, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(safeValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveField.test(key) ? "[REDACTED]" : safeValue(item),
      ]),
    );
  }
  return value;
}

export function createRequestId(): string {
  return randomUUID();
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeValue(fields) as LogFields,
  };
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}
