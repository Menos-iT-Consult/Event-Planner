import { describe, expect, it } from "vitest";
import { phoneNumberSchema, voterContactSchema } from "../src/lib/contact.js";

describe("contact validation", () => {
  it("normalizes whitespace in international phone numbers", () => {
    expect(phoneNumberSchema.parse("+233 24 000 0000")).toBe("+233240000000");
  });

  it("accepts phone or email voter identities", () => {
    expect(voterContactSchema.parse("person@example.com")).toBe("person@example.com");
    expect(voterContactSchema.parse("+233 24 000 0000")).toBe("+233240000000");
  });

  it("rejects malformed contacts", () => {
    expect(phoneNumberSchema.safeParse("123").success).toBe(false);
    expect(voterContactSchema.safeParse("not a contact").success).toBe(false);
  });
});
