import { z } from "zod";

export const phoneNumberSchema = z.string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, "Enter a valid international phone number"));

export const voterContactSchema = z.string()
  .trim()
  .transform((value) => /^\+?[\d\s()-]+$/.test(value) ? value.replace(/[\s()-]/g, "") : value)
  .refine(
    (value) => /^\+?[1-9]\d{7,14}$/.test(value) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "Enter a valid phone number or email address",
  );
