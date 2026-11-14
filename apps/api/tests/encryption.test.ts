import { describe, expect, it } from "vitest";
import { decryptText, encryptText } from "../src/lib/encryption.js";

const key = Buffer.alloc(32, 7);

describe("encrypted secrets", () => {
  it("round-trips an encrypted value", () => {
    const encrypted = encryptText("totp-secret", key);
    expect(encrypted).not.toContain("totp-secret");
    expect(decryptText(encrypted, key)).toBe("totp-secret");
  });

  it("rejects a value whose authentication tag no longer matches", () => {
    const encrypted = encryptText("totp-secret", key);
    expect(() => decryptText(encrypted, Buffer.alloc(32, 8))).toThrow();
  });

  it("continues to read legacy plaintext values for migration compatibility", () => {
    expect(decryptText("legacy-secret", key)).toBe("legacy-secret");
  });
});
