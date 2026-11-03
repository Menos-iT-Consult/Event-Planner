import { describe, expect, it } from "vitest";
import { inclusiveCalendarDays, parseDateOnly } from "../src/lib/duration.js";

describe("inclusiveCalendarDays", () => {
  it("counts a same-day event as one billable day", () => {
    expect(inclusiveCalendarDays("2026-04-04", "2026-04-04")).toBe(1);
  });

  it("counts both endpoint calendar dates", () => {
    expect(inclusiveCalendarDays("2026-04-04", "2026-04-06")).toBe(3);
  });

  it("handles leap days using UTC calendar dates", () => {
    expect(inclusiveCalendarDays("2024-02-28", "2024-03-01")).toBe(3);
  });

  it("rejects a reversed date range", () => {
    expect(() => inclusiveCalendarDays("2026-04-06", "2026-04-04")).toThrow(
      "endDate must be on or after startDate",
    );
  });

  it("rejects impossible dates", () => {
    expect(() => parseDateOnly("2026-02-30")).toThrow("Date is invalid");
  });
});

