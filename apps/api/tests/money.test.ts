import { describe, expect, it } from "vitest";
import { moneySchema } from "../src/lib/money.js";

describe("moneySchema", () => {
  it("accepts non-negative currency values with two decimal places", () => {
    expect(moneySchema().safeParse(10.25).success).toBe(true);
    expect(moneySchema().safeParse(0).success).toBe(true);
  });

  it("rejects values with more than two decimal places", () => {
    expect(moneySchema().safeParse(10.257).success).toBe(false);
  });

  it("enforces positive prices when requested", () => {
    expect(moneySchema(0.01).safeParse(0).success).toBe(false);
  });
});
