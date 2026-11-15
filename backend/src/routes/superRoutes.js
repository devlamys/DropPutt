// /api/v1/super — Super Admin, across franchises (no tenant header needed).

import argon2 from "argon2";
import { Router } from "express";
import { z } from "zod";
import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { env } from "../config/env.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { normalizeSlug } from "../middleware/resolveTenant.js";
import { audit } from "../utils/audit.js";
import { money } from "../utils/orderMath.js";
import { normalizePhone } from "../utils/phone.js";
import { AppError, asyncHandler, ok, validationError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { parse, parseId, zMoney } from "../utils/validate.js";

const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN"));

// Subdomains that can never be a franchise.
const RESERVED_SLUGS = new Set([env.adminSlug, "www", "api", "app", "static", "cdn", "mail"]);

const franchiseView = (franchise) => ({
  id: franchise.id,
  name: franchise.name,
  slug: franchise.slug,
  is_active: franchise.is_active,
  wallet_balance: moneyStr(franchise.wallet_balance),
  min_balance_limit: moneyStr(franchise.min_balance_limit),
  royalty_per_order: moneyStr(franchise.royalty_per_order),
  default_commission_rate: moneyStr(franchise.default_commission_rate),
  whatsapp_phone_number_id: franchise.whatsapp_phone_number_id,
  whatsapp_enabled: franchise.whatsapp_enabled,
  is_launch_promo_active: franchise.is_launch_promo_active,
  created_at: franchise.created_at,
  counts: franchise._count
    ? {
        vendors: franchise._count.vendors,
        riders: franchise._count.riders,
        orders: franchise._count.orders,
      }
    : undefined,
});

// GET /api/v1/super/franchises
router.get(
  "/franchises",
  asyncHandler(async (req, res) => {
    const franchises = await prisma.franchise.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { vendors: true, riders: true, orders: true } } },
    });
    ok(res, { franchises: franchises.map(franchiseView) });
  })
);

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(2).max(63),
  royalty_per_order: zMoney.optional(),
  default_commission_rate: z.coerce.number().min(0).max(100).optional(),
  opening_wallet_balance: zMoney.optional(),
  admin: z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.union([z.string(), z.number()]),
    pin: z.string().regex(/^\d{4,12}$/, "must be 4–12 digits"),
  }),
});

// POST /api/v1/super/franchises — new franchise + its Franchise Admin login.
router.post(
  "/franchises",
  asyncHandler(async (req, res) => {
    const body = parse(createSchema, req.body);
    const slug = normalizeSlug(body.slug);
    if (!slug || RESERVED_SLUGS.has(slug)) {
      throw validationError("Request validation failed", [
        { field: "slug", issue: "use lowercase letters, digits and hyphens (not a reserved name)" },
      ]);
    }
    const phone = normalizePhone(body.admin.phone);
    if (!phone) {
      throw validationError("Request validation failed", [
        { field: "admin.phone", issue: "must be a valid 10-digit mobile number" },
      ]);
    }
    const pin_hash = await argon2.hash(body.admin.pin);
    const opening = moneyStr(body.opening_wallet_balance ?? "0");

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const franchise = await tx.franchise.create({
          data: {
            name: body.name,
            slug,
            wallet_balance: opening,
            ...(body.default_commission_rate !== undefined
              ? { default_commission_rate: money(body.default_commission_rate).toFixed(2) }
              : {}),
            ...(body.royalty_per_order !== undefined
              ? { royalty_per_order: moneyStr(body.royalty_per_order) }
              : {}),
          },
        });
        const admin = await tx.user.create({
          data: {
            franchise_id: franchise.id,
            name: body.admin.name,
            phone,
            pin_hash,
            role: "FRANCHISE_ADMIN",
          },
        });
        if (Number(opening) > 0) {
          await tx.walletTransaction.create({
            data: {
              franchise_id: franchise.id,
              type: "CREDIT",
              amount: opening,
              balance_after: opening,
              description: "Opening wallet balance",
            },
          });
        }
        return { franchise, admin };
      }, TX_OPTIONS);
    } catch (error) {
      if (error?.code === "P2002" && String(error.meta?.target).includes("slug")) {
        throw new AppError(409, "SLUG_TAKEN", `The subdomain "${slug}" is already in use`);
      }
      throw error;
    }

    audit("franchise.created", {
      franchise_id: created.franchise.id,
      slug,
      by_user_id: req.user.id,
      admin_user_id: created.admin.id,
      opening_wallet_balance: opening,
    });

    ok(
      res,
      {
        franchise: franchiseView(created.franchise),
        admin: { id: created.admin.id, name: created.admin.name, phone },
      },
      { status: 201 }
    );
  })
);

const patchSchema = z
  .object({
    is_active: z.boolean().optional(),
    default_commission_rate: z.coerce.number().min(0).max(100).optional(),
    // Also set this rate on every hotel already in the franchise.
    apply_to_hotels: z.boolean().optional(),
    // WhatsApp ordering: Meta's phone-number id (digits) for this franchise's number, and the switch.
    whatsapp_phone_number_id: z.string().trim().regex(/^\d{5,32}$/, "digits only").nullable().optional(),
    whatsapp_enabled: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.is_active !== undefined ||
      body.default_commission_rate !== undefined ||
      body.whatsapp_phone_number_id !== undefined ||
      body.whatsapp_enabled !== undefined,
    {
      message: "nothing to update",
    }
  )
  .refine((body) => !body.apply_to_hotels || body.default_commission_rate !== undefined, {
    message: "apply_to_hotels needs default_commission_rate",
    path: ["apply_to_hotels"],
  });

// PATCH /api/v1/super/franchises/:id — activate / suspend a franchise, and set
// its default hotel commission % (optionally applied to existing hotels too).
router.patch(
  "/franchises/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = parse(patchSchema, req.body);
    const rate = body.default_commission_rate === undefined ? undefined : money(body.default_commission_rate).toFixed(2);
    const before = await prisma.franchise.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "NOT_FOUND", "Franchise not found");
    let applied = 0;
    await prisma.$transaction(async (tx) => {
      await tx.franchise.update({
        where: { id },
        data: {
          ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
          ...(rate !== undefined ? { default_commission_rate: rate } : {}),
          ...(body.whatsapp_phone_number_id !== undefined ? { whatsapp_phone_number_id: body.whatsapp_phone_number_id } : {}),
          ...(body.whatsapp_enabled !== undefined ? { whatsapp_enabled: body.whatsapp_enabled } : {}),
        },
      });
      if (body.apply_to_hotels) {
        applied = (await tx.vendor.updateMany({ where: { franchise_id: id }, data: { commission_rate: rate } })).count;
      }
    });
    audit("franchise.settings_by_super", {
      franchise_id: id,
      by_user_id: req.user.id,
      before: { is_active: before.is_active, default_commission_rate: moneyStr(before.default_commission_rate) },
      after: { is_active: body.is_active ?? before.is_active, default_commission_rate: rate ?? moneyStr(before.default_commission_rate) },
      hotels_updated: applied,
    });
    const franchise = await prisma.franchise.findUnique({ where: { id } });
    ok(res, { franchise: franchiseView(franchise), hotels_updated: applied });
  })
);

export default router;
