// JWT verification and role guards (SPEC §49, §55.1).

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import {
  AppError,
  asyncHandler,
  forbidden,
  unauthenticated,
} from "../utils/response.js";

/** Claims: sub, role, franchise_id, sid (refresh-token row), iat, exp, jti. */
export function signAccessToken(user, sessionId) {
  return jwt.sign(
    { role: user.role, franchise_id: user.franchise_id, sid: sessionId },
    env.jwtSecret,
    {
      algorithm: "HS256",
      subject: String(user.id),
      expiresIn: env.accessTokenTtlSeconds,
      jwtid: crypto.randomUUID(),
    }
  );
}

/** Returns the verified payload or throws TOKEN_EXPIRED / UNAUTHENTICATED. */
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(401, "TOKEN_EXPIRED", "Access token expired");
    }
    throw unauthenticated("Invalid access token");
  }
}

/**
 * Verifies the token, then re-loads the user so deactivated accounts and
 * role / franchise changes take effect immediately.
 */
export async function resolveUserFromToken(token) {
  const payload = verifyAccessToken(token);
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId)) throw unauthenticated("Invalid access token");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, franchise_id: true, is_active: true },
  });
  if (
    !user ||
    !user.is_active ||
    user.role !== payload.role ||
    user.franchise_id !== (payload.franchise_id ?? null)
  ) {
    throw unauthenticated("Invalid access token");
  }
  return { user, payload };
}

/**
 * Requires `Authorization: Bearer <token>`. When the tenant has been
 * resolved, the user must belong to it — except the global SUPER_ADMIN,
 * who acts on whichever franchise the header selects.
 */
export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw unauthenticated();

  const { user, payload } = await resolveUserFromToken(token);

  if (
    req.franchise_id !== undefined &&
    user.role !== "SUPER_ADMIN" &&
    user.franchise_id !== req.franchise_id
  ) {
    throw forbidden("This account does not belong to this franchise");
  }

  req.user = { ...user, session_id: payload.sid ?? null };
  next();
});

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthenticated());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Loads the authenticated rider's profile, scoped to the tenant. */
export const loadRider = asyncHandler(async (req, res, next) => {
  const rider = await prisma.rider.findFirst({
    where: { user_id: req.user.id, franchise_id: req.franchise_id },
  });
  if (!rider) throw forbidden("Rider profile not found in this franchise");
  req.rider = rider;
  next();
});
