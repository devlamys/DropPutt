// Resolves the tenant from `x-franchise-slug` (SPEC §4) and sets
// req.franchise_id. A client-supplied franchise_id is never trusted.

import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError, asyncHandler } from "../utils/response.js";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase();
  return SLUG_PATTERN.test(slug) ? slug : null;
}

const franchiseInactive = () =>
  new AppError(403, "FRANCHISE_INACTIVE", "Franchise not active or not found");

/** Loads an active franchise by slug or throws 403 FRANCHISE_INACTIVE. */
export async function loadActiveFranchise(rawSlug) {
  const slug = normalizeSlug(rawSlug);
  if (!slug) throw franchiseInactive();
  const franchise = await prisma.franchise.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, is_active: true },
  });
  if (!franchise || !franchise.is_active) throw franchiseInactive();
  return franchise;
}

export const resolveTenant = asyncHandler(async (req, res, next) => {
  // In local development a missing header falls back to the default
  // franchise (kizhissery). In production the header is mandatory.
  const rawSlug = req.get("x-franchise-slug") || env.defaultFranchiseSlug;
  if (!rawSlug) throw franchiseInactive();

  const franchise = await loadActiveFranchise(rawSlug);
  req.franchise = franchise;
  req.franchise_id = franchise.id;
  next();
});
