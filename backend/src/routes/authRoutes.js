// /api/v1/auth — PIN login, refresh-token rotation, logout (SPEC §49).

import crypto from "node:crypto";
import argon2 from "argon2";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { authenticate, signAccessToken } from "../middleware/auth.js";
import {
  loginAccountLimiter,
  loginIpLimiter,
  refreshLimiter,
} from "../middleware/rateLimit.js";
import { loadActiveFranchise, normalizeSlug } from "../middleware/resolveTenant.js";
import { normalizePhone } from "../utils/phone.js";
import { asyncHandler, ok, unauthenticated, validationError } from "../utils/response.js";
import { parse } from "../utils/validate.js";

const router = Router();

const REFRESH_TTL_SECONDS = env.refreshTokenTtlDays * 24 * 60 * 60;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// Computed once at module init and re-awaited on every missing-user login attempt.
// This equalises response timing between "user not found" and "wrong PIN" so that
// an attacker cannot enumerate valid phone numbers by measuring response time.
// The promise resolves once and subsequent awaits return immediately — the timing
// benefit comes from argon2.verify() on a real hash taking the same wall-clock
// time regardless of whether the user exists.
const dummyHashPromise = argon2.hash(crypto.randomBytes(16).toString("hex"));

/** Creates a refresh-token row and returns the token pair. */
async function issueTokens(db, user) {
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const session = await db.refreshToken.create({
    data: {
      user_id: user.id,
      token_hash: sha256(refreshToken),
      expires_at: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    },
  });
  return {
    access_token: signAccessToken(user, session.id),
    refresh_token: refreshToken,
    access_token_expires_in: env.accessTokenTtlSeconds,
    refresh_token_expires_in: REFRESH_TTL_SECONDS,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      franchise_id: user.franchise_id,
    },
  };
}

const loginSchema = z.object({
  phone: z.union([z.string(), z.number()]),
  pin: z.string().min(4).max(12),
  franchise_slug: z.string().max(63).optional(),
});

// POST /api/v1/auth/login
//
// The tenant comes from body.franchise_slug, else the x-franchise-slug
// header, else (development only) the default franchise. The reserved slug
// "admin" logs in the global Super Admin.
router.post(
  "/login",
  loginIpLimiter,
  loginAccountLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const phone = normalizePhone(body.phone);
    if (!phone) {
      throw validationError("Request validation failed", [
        { field: "phone", issue: "must be a valid 10-digit mobile number" },
      ]);
    }

    const rawSlug =
      body.franchise_slug || req.get("x-franchise-slug") || env.defaultFranchiseSlug;
    if (!rawSlug) {
      throw validationError("Request validation failed", [
        { field: "franchise_slug", issue: "required" },
      ]);
    }

    let user;
    if (normalizeSlug(rawSlug) === env.adminSlug) {
      user = await prisma.user.findFirst({
        where: { franchise_id: null, role: "SUPER_ADMIN", phone },
      });
    } else {
      const franchise = await loadActiveFranchise(rawSlug); // 403 FRANCHISE_INACTIVE
      // Attach to req so any middleware added later has the tenant available.
      req.franchise_id = franchise.id;
      req.franchise = franchise;
      user = await prisma.user.findUnique({
        where: { franchise_id_phone: { franchise_id: franchise.id, phone } },
      });
    }

    const pinMatches = await argon2
      .verify(user ? user.pin_hash : await dummyHashPromise, body.pin)
      .catch(() => false);
    if (!user || !user.is_active || !pinMatches) {
      throw unauthenticated("Invalid phone or PIN");
    }

    ok(res, await issueTokens(prisma, user));
  })
);

const refreshSchema = z.object({ refresh_token: z.string().min(32).max(256) });

// POST /api/v1/auth/refresh — rotates the refresh token.
router.post(
  "/refresh",
  refreshLimiter,
  asyncHandler(async (req, res) => {
    const { refresh_token } = parse(refreshSchema, req.body);
    const stored = await prisma.refreshToken.findUnique({
      where: { token_hash: sha256(refresh_token) },
      include: { user: true },
    });
    if (!stored) throw unauthenticated("Invalid refresh token");

    const revokeFamily = () =>
      prisma.refreshToken.updateMany({
        where: { user_id: stored.user_id, revoked: false },
        data: { revoked: true },
      });

    // A revoked token being presented again is a rotation attack.
    if (stored.revoked) {
      await revokeFamily();
      throw unauthenticated("Refresh token already used");
    }
    if (stored.expires_at <= new Date() || !stored.user.is_active) {
      throw unauthenticated("Refresh token expired");
    }

    const tokens = await prisma.$transaction(async (tx) => {
      // Conditional update so two concurrent refreshes cannot both win.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revoked: false },
        data: { revoked: true },
      });
      return count === 1 ? issueTokens(tx, stored.user) : null;
    });
    if (!tokens) {
      await revokeFamily();
      throw unauthenticated("Refresh token already used");
    }

    ok(res, tokens);
  })
);

// POST /api/v1/auth/logout — revokes the refresh token of this session.
router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.user.session_id) {
      await prisma.refreshToken.updateMany({
        where: { id: req.user.session_id, user_id: req.user.id, revoked: false },
        data: { revoked: true },
      });
    }
    ok(res, { logged_out: true });
  })
);

export default router;
