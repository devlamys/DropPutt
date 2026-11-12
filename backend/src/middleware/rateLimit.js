import rateLimit from "express-rate-limit";
import { fail } from "../utils/response.js";

function limiter({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: true, // X-RateLimit-* + Retry-After for mobile retry logic
    handler: (req, res) =>
      fail(res, 429, "RATE_LIMITED", "Too many requests. Please try again shortly."),
  });
}

export const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 20 });
export const publicLimiter = limiter({ windowMs: 60 * 1000, limit: 60 });
export const publicWriteLimiter = limiter({ windowMs: 60 * 1000, limit: 12 });
