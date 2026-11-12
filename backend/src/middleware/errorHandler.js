import multer from "multer";
import { AppError, fail } from "../utils/response.js";

export function notFoundHandler(req, res) {
  fail(res, 404, "NOT_FOUND", "Route not found");
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }

  if (err instanceof multer.MulterError) {
    return fail(res, 422, "VALIDATION_ERROR", "Upload rejected", [
      { field: err.field || "file", issue: err.message },
    ]);
  }

  // Malformed / oversized JSON bodies from express.json().
  if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    return fail(res, 422, "VALIDATION_ERROR", "Request body could not be read");
  }

  // Anything else (including Prisma errors) is internal: log it, never leak it.
  console.error(
    JSON.stringify({
      level: "error",
      request_id: res.locals.request_id,
      path: req.originalUrl?.split("?")[0],
      name: err?.name,
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
    })
  );
  return fail(res, 500, "INTERNAL_ERROR", "Something went wrong");
}
