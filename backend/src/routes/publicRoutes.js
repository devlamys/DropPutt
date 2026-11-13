// /api/v1/public/drop/:token — customer Magic Link (no login).
//
// The opaque location_token is the only credential. The tenant is derived
// from the order it resolves to, and responses expose only what the
// customer needs: no rider identity, no splits, no franchise internals.

import { Router } from "express";
import { z } from "zod";
import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { idempotency } from "../middleware/idempotency.js";
import { publicLimiter, publicWriteLimiter } from "../middleware/rateLimit.js";
import { voiceUpload } from "../middleware/upload.js";
import { cancelOrder } from "../services/orderCancelService.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { audit } from "../utils/audit.js";
import {
  ACTIVE_ORDER_STATUSES,
  GPS_ACCURACY_LIMIT_METRES,
  GPS_ACCURACY_WARNING_ML,
} from "../utils/constants.js";
import { ALLOWED_TIP_AMOUNTS, applyTip, isAllowedTipAmount } from "../utils/orderMath.js";
import { AppError, asyncHandler, ok, orderNotFound, validationError } from "../utils/response.js";
import { coordStr, moneyStr } from "../utils/serializers.js";
import { saveUpload } from "../utils/storage.js";
import { parse, zLat, zLng } from "../utils/validate.js";

const router = Router();
router.use(publicLimiter);

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const STATUS_MESSAGES = Object.freeze({
  RIDER_REQUESTED: "Looking for a rider",
  RIDER_ASSIGNED: "Rider is heading to the shop",
  PICKED_UP: "Rider is on the way",
  LOCATION_SHARED: "Rider is on the way",
  DELIVERED: "Order delivered",
  CANCELLED: "Order cancelled",
});

function requireToken(req) {
  const token = req.params.token;
  if (!TOKEN_PATTERN.test(token)) throw orderNotFound();
  return token;
}

/** Live rider position — coordinates only, and only while the order is active. */
function riderPosition(order) {
  const rider = order.rider;
  const active = ACTIVE_ORDER_STATUSES.includes(order.order_status);
  return {
    rider_lat: active && rider ? coordStr(rider.current_lat) : null,
    rider_lng: active && rider ? coordStr(rider.current_lng) : null,
    rider_last_seen: active && rider ? rider.last_location_at : null,
  };
}

const riderPositionSelect = {
  select: { current_lat: true, current_lng: true, last_location_at: true },
};

// GET /api/v1/public/drop/:token — data for the Magic Link page.
router.get(
  "/drop/:token",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { location_token: requireToken(req) },
      include: {
        vendor: { select: { shop_name: true } },
        rider: {
          select: {
            ...riderPositionSelect.select,
            vehicle_type: true,
            user: { select: { name: true } },
          },
        },
      },
    });
    if (!order) throw orderNotFound();

    ok(res, {
      order_number: order.order_number,
      order_status: order.order_status,
      estimated_message: STATUS_MESSAGES[order.order_status],
      shop_name: order.vendor?.shop_name ?? order.custom_shop_name ?? null,
      payment_method: order.payment_method,
      item_total: moneyStr(order.item_total),
      delivery_fee: moneyStr(order.delivery_fee),
      rider_tip: moneyStr(order.rider_tip),
      discount_amount: moneyStr(order.discount_amount),
      grand_total: moneyStr(order.grand_total),
      amount_to_collect: moneyStr(order.amount_to_collect),
      has_drop_location: order.drop_lat !== null && order.drop_lng !== null,
      // The customer's own pin, so the page can show "home" on the map.
      drop_lat: coordStr(order.drop_lat),
      drop_lng: coordStr(order.drop_lng),
      // First name and vehicle only — never phone, KYC or vehicle number (§28).
      rider: order.rider
        ? {
            first_name: order.rider.user.name.trim().split(/\s+/)[0],
            vehicle_type: order.rider.vehicle_type,
          }
        : null,
      turning_point: order.turning_point,
      has_voice_note: Boolean(order.voice_note_url),
      tip_options: ALLOWED_TIP_AMOUNTS,
      can_tip: Boolean(order.rider_id) && ACTIVE_ORDER_STATUSES.includes(order.order_status),
      // The customer may withdraw only until a rider has taken the order.
      can_cancel: order.order_status === "RIDER_REQUESTED",
      cancel_reason: order.order_status === "CANCELLED" ? order.cancel_reason : null,
      gps_accuracy_limit_metres: GPS_ACCURACY_LIMIT_METRES,
      ...riderPosition(order),
    });
  })
);

// GET /api/v1/public/drop/:token/status — REST fallback for live tracking.
router.get(
  "/drop/:token/status",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { location_token: requireToken(req) },
      select: { order_status: true, rider: riderPositionSelect },
    });
    if (!order) throw orderNotFound();

    ok(res, {
      order_status: order.order_status,
      ...riderPosition(order),
      estimated_message: STATUS_MESSAGES[order.order_status],
    });
  })
);

// POST /api/v1/public/drop/:token/voice-and-pin — rural GPS pin + voice route.
const pinSchema = z.object({
  lat: zLat,
  lng: zLng,
  gps_accuracy: z.coerce.number().min(0).max(100000),
  turning_point: z.string().trim().min(1).max(300).optional(),
  voice_direction_url: z.string().trim().min(1).max(2048).optional(),
});

router.post(
  "/drop/:token/voice-and-pin",
  publicWriteLimiter,
  voiceUpload, // multipart field "voice"; JSON bodies also work
  asyncHandler(async (req, res) => {
    const token = requireToken(req);
    const body = parse(pinSchema, req.body);
    const hasVoice = Boolean(req.file || body.voice_direction_url);
    const accuracyPoor = body.gps_accuracy > GPS_ACCURACY_LIMIT_METRES;
    const warning = accuracyPoor
      ? { code: "GPS_ACCURACY_POOR", message: GPS_ACCURACY_WARNING_ML }
      : null;

    const current = await prisma.order.findUnique({
      where: { location_token: token },
      select: { id: true, franchise_id: true, order_status: true },
    });
    if (!current) throw orderNotFound();
    if (!ACTIVE_ORDER_STATUSES.includes(current.order_status)) {
      throw new AppError(
        409,
        "ORDER_NOT_ACTIVE",
        "Location can only be shared while the delivery is in progress"
      );
    }

    // Weak GPS and no voice route: warn, and do not store the point as a
    // gate location. HTTP 200 — the customer simply retries from outside
    // or records the route.
    if (accuracyPoor && !hasVoice) {
      return ok(res, {
        saved: false,
        gps_accuracy: body.gps_accuracy,
        gps_accuracy_poor: true,
        warning,
      });
    }

    const voiceUrl = req.file
      ? await saveUpload(req.file, `voice/${current.franchise_id}/${current.id}`)
      : (body.voice_direction_url ?? null);

    const order = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`
        SELECT id FROM "orders" WHERE id = ${current.id} FOR UPDATE
      `;
      if (locked.length === 0) throw orderNotFound();
      const row = await tx.order.findUnique({ where: { id: current.id } });
      if (!ACTIVE_ORDER_STATUSES.includes(row.order_status)) {
        throw new AppError(
          409,
          "ORDER_NOT_ACTIVE",
          "Location can only be shared while the delivery is in progress"
        );
      }

      const lat = body.lat.toFixed(7);
      const lng = body.lng.toFixed(7);
      const shared = {
        ...(body.turning_point ? { turning_point: body.turning_point } : {}),
        ...(voiceUrl ? { voice_direction_url: voiceUrl } : {}),
      };

      // Raw customer GPS on the franchise-scoped customer record.
      let verifiedGate = false;
      if (row.customer_phone) {
        const raw = { lat, lng, gps_accuracy: body.gps_accuracy.toFixed(2), ...shared };
        const customer = await tx.customer.upsert({
          where: {
            franchise_id_phone: {
              franchise_id: row.franchise_id,
              phone: row.customer_phone,
            },
          },
          update: raw,
          create: {
            franchise_id: row.franchise_id,
            phone: row.customer_phone,
            name: row.customer_name,
            ...raw,
          },
        });
        verifiedGate =
          customer.is_location_verified &&
          customer.verified_lat !== null &&
          row.drop_lat !== null;
      }

      // A rider-verified gate location stays the navigation target; the
      // customer's raw pin only fills the order when no verified one exists.
      return tx.order.update({
        where: { id: row.id },
        data: {
          ...(verifiedGate ? {} : { drop_lat: lat, drop_lng: lng }),
          ...(body.turning_point ? { turning_point: body.turning_point } : {}),
          ...(voiceUrl ? { voice_note_url: voiceUrl } : {}),
          order_status:
            row.order_status === "PICKED_UP" ? "LOCATION_SHARED" : row.order_status,
        },
      });
    }, TX_OPTIONS);

    if (order.rider_id) {
      emitTo(rooms.rider(order.rider_id), "customer_location_shared", {
        order_id: order.id,
        order_status: order.order_status,
        drop_lat: coordStr(order.drop_lat),
        drop_lng: coordStr(order.drop_lng),
        turning_point: order.turning_point,
        voice_note_url: order.voice_note_url,
        gps_accuracy: body.gps_accuracy,
        gps_accuracy_poor: accuracyPoor,
      });
    }
    emitTo(rooms.order(order.id), "order_status_changed", {
      order_id: order.id,
      order_status: order.order_status,
    });

    ok(res, {
      saved: true,
      order_status: order.order_status,
      gps_accuracy: body.gps_accuracy,
      gps_accuracy_poor: accuracyPoor,
      has_voice_note: Boolean(order.voice_note_url),
      warning,
    });
  })
);

// POST /api/v1/public/drop/:token/tip — ₹10 / ₹20 / ₹30, 100% to the rider.
const tipSchema = z.object({
  tip: z.coerce.number(),
  client_action_id: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/)
    .optional(),
});

router.post(
  "/drop/:token/tip",
  publicWriteLimiter,
  idempotency(),
  asyncHandler(async (req, res) => {
    const token = requireToken(req);
    const body = parse(tipSchema, req.body);
    if (!isAllowedTipAmount(body.tip)) {
      throw new AppError(422, "INVALID_TIP_AMOUNT", "Tip must be 10, 20 or 30");
    }

    // One customer action = one id. Retries reuse it and change nothing.
    const actionId = body.client_action_id ?? req.get("idempotency-key");
    if (!actionId || !/^[A-Za-z0-9-]{8,128}$/.test(actionId)) {
      throw validationError("Request validation failed", [
        { field: "client_action_id", issue: "required (or send an Idempotency-Key header)" },
      ]);
    }

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`
        SELECT id FROM "orders" WHERE location_token = ${token} FOR UPDATE
      `;
      if (locked.length === 0) throw orderNotFound();
      const order = await tx.order.findUnique({ where: { id: locked[0].id } });

      const reference_key = `order:${order.id}:tip:${actionId}`;
      const existing = await tx.settlementEntry.findUnique({ where: { reference_key } });
      if (existing) return { order, applied: false };

      if (!order.rider_id || !ACTIVE_ORDER_STATUSES.includes(order.order_status)) {
        throw new AppError(
          409,
          "ORDER_NOT_ACTIVE",
          "Tips can only be added while the delivery is in progress"
        );
      }

      const next = applyTip(order, body.tip);
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          rider_tip: moneyStr(next.rider_tip),
          rider_earning: moneyStr(next.rider_earning),
          grand_total: moneyStr(next.grand_total),
          amount_to_collect: moneyStr(next.amount_to_collect),
        },
      });
      await tx.settlementEntry.create({
        data: {
          franchise_id: order.franchise_id,
          order_id: order.id,
          rider_id: order.rider_id,
          party: "RIDER_EARNING",
          type: "RIDER_TIP",
          amount: moneyStr(body.tip),
          reference_key,
          description: `Customer tip for order ${order.order_number}`,
        },
      });
      audit("order.tip", {
        franchise_id: order.franchise_id,
        order_id: order.id,
        rider_id: order.rider_id,
        tip: moneyStr(body.tip),
        reference_key,
      });
      return { order: updated, applied: true };
    }, TX_OPTIONS);

    const { order, applied } = result;
    if (applied && order.rider_id) {
      emitTo(rooms.rider(order.rider_id), "tip_added", {
        order_id: order.id,
        tip: moneyStr(body.tip),
        rider_tip: moneyStr(order.rider_tip),
        amount_to_collect: moneyStr(order.amount_to_collect),
      });
    }

    ok(res, {
      applied,
      rider_tip: moneyStr(order.rider_tip),
      grand_total: moneyStr(order.grand_total),
      amount_to_collect: moneyStr(order.amount_to_collect),
    });
  })
);

// POST /api/v1/public/drop/:token/cancel — the customer withdraws an order that
// no rider has accepted yet. Idempotent (a second tap just returns CANCELLED).
router.post(
  "/drop/:token/cancel",
  publicWriteLimiter,
  asyncHandler(async (req, res) => {
    const token = requireToken(req);
    const current = await prisma.order.findUnique({
      where: { location_token: token },
      select: { id: true, franchise_id: true, franchise: { select: { slug: true } } },
    });
    if (!current) throw orderNotFound();

    const { order, already } = await cancelOrder({
      orderId: current.id,
      franchise_id: current.franchise_id,
      role: "CUSTOMER",
      franchise_slug: current.franchise.slug,
    });
    ok(res, { cancelled: true, already, order_status: order.order_status });
  })
);

export default router;
