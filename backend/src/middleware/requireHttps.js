// SPEC §37.11 — HTTPS is mandatory in production.
//
// Behind Nginx / Cloudflare the proxy terminates TLS and forwards
// X-Forwarded-Proto, so TRUST_PROXY must be set for `req.secure` to be
// correct. /health and /ready stay reachable over plain HTTP for load-balancer probes.

import { fail } from "../utils/response.js";

export function requireHttps(req, res, next) {
  if (req.secure || req.path === "/health" || req.path === "/ready") return next();
  return fail(res, 400, "HTTPS_REQUIRED", "This API is only available over HTTPS.");
}
