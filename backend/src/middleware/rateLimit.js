import rateLimit from "express-rate-limit";
import { normalizePhone } from "../utils/phone.js";
import { fail } from "../utils/response.js";

const MINUTE = 60 * 1000;

function limiter({ windowMs, limit, keyGenerator, skipSuccessfulRequests }) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    skipSuccessfulRequests,
    standardHeaders: "draft-7",
    legacyHeaders: true, // X-RateLimit-* + Retry-After for mobile retry logic
    handler: (req, res) =>
      fail(res, 429, "RATE_LIMITED", "Too many requests. Please try again shortly."),
  });
}

// IP limits are generous on purpose: rural mobile networks put many real
// users behind one address. They only stop floods. Per-account / per-token
// limits below do the targeted protection.
//
// All IP limits need TRUST_PROXY set correctly behind a reverse proxy,
// otherwise req.ip is the proxy's address for everybody.

// Login: wrong-PIN attempts are limited per account (4-digit PINs are
// brute-forceable), plus a broad per-IP flood limit. The account limiter
// counts only failed attempts, so normal logins never use it up. The
// trade-off: someone who knows a phone number can lock that account's
// logins for up to 15 minutes by guessing wrongly.
export const loginIpLimiter = limiter({ windowMs: 15 * MINUTE, limit: 100 });

export const loginAccountLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return `ip:${req.ip}`;
    const slug = String(
      req.body?.franchise_slug || req.get("x-franchise-slug") || ""
    )
      .trim()
      .toLowerCase()
      .slice(0, 63);
    return `acct:${slug}:${phone}`;
  },
});

// Refresh tokens are 256-bit random values, so guessing is infeasible; this
// only caps floods. Every signed-in app refreshes every 15 minutes, hence
// the headroom.
export const refreshLimiter = limiter({ windowMs: 15 * MINUTE, limit: 300 });

// Magic Link: broad per-IP limit for reads; writes (pin, tip) are limited
// per link, the actual credential, rather than per shared IP.
export const publicLimiter = limiter({ windowMs: MINUTE, limit: 300 });

export const publicWriteLimiter = limiter({
  windowMs: MINUTE,
  limit: 20,
  keyGenerator: (req) => `link:${req.params.token}`,
});

// Customer checkout creates real rider requests: limit per phone number
// (the identity) on top of a broad per-IP flood limit.
export const checkoutIpLimiter = limiter({ windowMs: 10 * MINUTE, limit: 60 });
export const checkoutPhoneLimiter = limiter({
  windowMs: 10 * MINUTE,
  limit: 5,
  keyGenerator: (req) => `checkout:${normalizePhone(req.body?.customer_phone) || req.ip}`,
});
