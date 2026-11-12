// /api/v1/device — FCM token registration (SPEC §49.3).
//
// One row per physical token (fcm_token is unique). A token that moves to a
// different account is re-assigned, which deactivates it for the old owner.
// Safe to call on every app launch.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { resolveUserFromToken } from "../middleware/auth.js";
import { normalizePhone } from "../utils/phone.js";
import { asyncHandler, ok, unauthenticated, validationError } from "../utils/response.js";
import { parse } from "../utils/validate.js";

const router = Router();

const schema = z.object({
  fcm_token: z.string().trim().min(20).max(4096),
  platform: z.enum(["android", "ios", "web"]),
  app_version: z.string().trim().max(32).optional(),
  // Customers have no login: the Magic Link token identifies them.
  location_token: z.string().trim().min(16).max(128).optional(),
});

// POST /api/v1/device/register
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = parse(schema, req.body);

    let owner; // { user_id } | { customer_id }
    const header = req.get("authorization") || "";
    if (header) {
      const [scheme, token] = header.split(" ");
      if (scheme !== "Bearer" || !token) throw unauthenticated();
      const { user } = await resolveUserFromToken(token);
      owner = { user_id: user.id, customer_id: null };
    } else if (body.location_token) {
      const order = await prisma.order.findUnique({
        where: { location_token: body.location_token },
        select: { franchise_id: true, customer_phone: true },
      });
      const phone = normalizePhone(order?.customer_phone);
      const customer = phone
        ? await prisma.customer.findUnique({
            where: { franchise_id_phone: { franchise_id: order.franchise_id, phone } },
            select: { id: true },
          })
        : null;
      if (!customer) throw unauthenticated("Invalid tracking link");
      owner = { user_id: null, customer_id: customer.id };
    } else {
      throw validationError("Request validation failed", [
        { field: "authorization", issue: "Bearer token or location_token required" },
      ]);
    }

    const now = new Date();
    const data = {
      ...owner,
      platform: body.platform,
      app_version: body.app_version ?? null,
      is_active: true,
      last_seen_at: now,
    };
    const device = await prisma.deviceRegistration.upsert({
      where: { fcm_token: body.fcm_token },
      create: { fcm_token: body.fcm_token, ...data },
      update: data,
    });
    ok(res, { device_id: device.id, is_active: true }, { status: 200 });
  })
);

export default router;
