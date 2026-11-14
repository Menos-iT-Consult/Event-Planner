import { describe, expect, it } from "vitest";
import { addSubscriptionPeriod } from "../src/lib/subscription-period.js";

describe("addSubscriptionPeriod", () => {
  it("clamps monthly periods to the last day of the destination month", () => {
    expect(addSubscriptionPeriod(new Date("2025-01-31T12:00:00.000Z"), "MONTHLY"))
      .toEqual(new Date("2025-02-28T12:00:00.000Z"));
  });

  it("preserves leap day time while clamping a yearly period", () => {
    expect(addSubscriptionPeriod(new Date("2024-02-29T12:00:00.000Z"), "YEARLY"))
      .toEqual(new Date("2025-02-28T12:00:00.000Z"));
  });

  it("rejects unsupported billing intervals", () => {
    expect(() => addSubscriptionPeriod(new Date(), "WEEKLY")).toThrow("Unsupported subscription interval");
  });
});
