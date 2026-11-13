// SPEC §47 response envelope: { success, data | error, meta }.

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthenticated = (message = "Authentication required") =>
  new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You are not allowed to do this") =>
  new AppError(403, "FORBIDDEN", message);
export const orderNotFound = () =>
  new AppError(404, "ORDER_NOT_FOUND", "Order not found");
export const validationError = (message, details) =>
  new AppError(422, "VALIDATION_ERROR", message, details);
/** Shorthand for a single-field validation error. */
export const fieldError = (field, issue) =>
  validationError("Request validation failed", [{ field, issue }]);

export function buildMeta(res, extra) {
  return {
    request_id: res.locals.request_id,
    timestamp: new Date().toISOString(),
    version: "v1",
    ...extra,
  };
}

export function ok(res, data, { status = 200, pagination } = {}) {
  return res
    .status(status)
    .json({
      success: true,
      data,
      meta: buildMeta(res, pagination ? { pagination } : undefined),
    });
}

export function fail(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ success: false, error, meta: buildMeta(res) });
}

/** Express 4 does not catch rejected promises from async handlers. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
