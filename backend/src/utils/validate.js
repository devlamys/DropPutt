import { z } from "zod";
import { validationError } from "./response.js";

/** Parses `input` with a zod schema; throws a 422 VALIDATION_ERROR envelope. */
export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  throw validationError(
    "Request validation failed",
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      issue: issue.message,
    }))
  );
}

/** Positive integer route param (":id"). */
export function parseId(value, name = "id") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw validationError("Request validation failed", [
      { field: name, issue: "must be a positive integer" },
    ]);
  }
  return id;
}

// multipart/form-data delivers everything as strings.
export const zBoolean = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

/** Non-negative money amount with at most 2 decimals, kept as a string. */
export const zMoney = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d{1,9}(\.\d{1,2})?$/.test(value), {
    message: "must be a non-negative amount with at most 2 decimals",
  });

export const zLat = z.coerce.number().min(-90).max(90);
export const zLng = z.coerce.number().min(-180).max(180);
