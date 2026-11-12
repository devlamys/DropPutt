import crypto from "node:crypto";

/** Generates the server-side request id (SPEC §47) for body + header. */
export function requestContext(req, res, next) {
  const requestId = crypto.randomUUID();
  res.locals.request_id = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}
