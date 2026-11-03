import { describe, expect, it } from "vitest";
import { redactPrivateLinks } from "../src/lib/redact.js";

describe("redactPrivateLinks", () => {
  it("redacts RSVP and pass bearer tokens from persisted SMS text", () => {
    expect(redactPrivateLinks(
      "RSVP: https://events.example/rsvp/secret_token-1 Pass: https://events.example/pass/anotherSecret",
    )).toBe(
      "RSVP: https://events.example/rsvp/[REDACTED] Pass: https://events.example/pass/[REDACTED]",
    );
  });

  it("leaves ordinary event links unchanged", () => {
    expect(redactPrivateLinks("See https://events.example/e/summer-party"))
      .toBe("See https://events.example/e/summer-party");
  });
});
