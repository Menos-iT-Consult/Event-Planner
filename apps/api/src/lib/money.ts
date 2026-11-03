import { z } from "zod";

export function moneySchema(minimum = 0, maximum = 9_999_999_999.99) {
  return z.number()
    .finite()
    .min(minimum)
    .max(maximum)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, {
      message: "Amount can have no more than two decimal places",
    });
}

