// /api/v1/rider — the signed-in rider's own status (Rider app top bar).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, loadRider, requireRole } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { applyRiderLocationBatch, emitTo, rooms } from "../socket/socketHandler.js";
import { ACTIVE_ORDER_STATUSES } from "../utils/constants.js";
import { addMoney, money } from "../utils/orderMath.js";
import { AppError, asyncHandler, ok, orderNotFound } from "../utils/response.js";
import { coordStr, moneyStr } from "../utils/serializers.js";
import { istDayRange } from "../utils/time.js";
import { MAX_ID, parse } from "../utils/validate.js";

const router = Router();
router.use(authenticate, requireRole("RIDER"), loadRider);

async function statusView(rider, franchise_id) {
  const day = istDayRange();
  const [franchise, delivered_today] = await Promise.all([
    prisma.franchise.findUnique({
      where: { id: franchise_id },
      select: { daily_milestone_target: true, daily_milestone_bonus: true, name: true },
    }),
    prisma.order.count({
      where: {
        franchise_id,
        rider_id: rider.id,
        order_status: "DELIVERED",
        delivered_at: { gte: day.start, lt: day.end },
      },
    }),
  ]);
  return {
    rider: {
      id: rider.id,
      is_online: rider.is_online,
      is_approved: rider.is_approved,
      vehicle_type: rider.vehicle_type,
      max_active_orders: rider.max_active_orders,
      cash_in_hand: moneyStr(rider.cash_in_hand),
      max_cash_limit: moneyStr(rider.max_cash_limit),
      wallet_earnings: moneyStr(rider.wallet_earnings),
    },
    milestone: {
      delivered_today,
      target: franchise.daily_milestone_target,
      bonus: moneyStr(franchise.daily_milestone_bonus),
    },
    franchise_name: franchise.name,
  };
}

// GET /api/v1/rider/me
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    ok(res, await statusView(req.rider, req.franchise_id));
  })
);

const onlineSchema = z.object({ is_online: z.boolean() });

// PATCH /api/v1/rider/me/online
router.patch(
  "/me/online",
  asyncHandler(async (req, res) => {
    const { is_online } = parse(onlineSchema, req.body);
    if (is_online) {
      if (!req.rider.is_approved) {
        throw new AppError(403, "RIDER_NOT_APPROVED", "Your account is not approved yet");
      }
      if (req.rider.cash_in_hand.gte(req.rider.max_cash_limit)) {
        throw new AppError(
          422,
          "CASH_LIMIT_REACHED",
          "Cash in hand limit reached. Please settle with the admin first."
        );
      }
    }
    const rider = await prisma.rider.update({
      where: { id: req.rider.id },
      data: { is_online },
    });
    emitTo(rooms.franchise(req.franchise_id), "fleet_rider_status", {
      rider_id: rider.id,
      is_online,
    });
    ok(res, await statusView(rider, req.franchise_id));
  })
);

// GET /api/v1/riders/me/active-orders — offline sync (SPEC §52.2).
router.get(
  "/me/active-orders",
  asyncHandler(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: {
        franchise_id: req.franchise_id,
        rider_id: req.rider.id,
        order_status: { in: ACTIVE_ORDER_STATUSES },
      },
      orderBy: { created_at: "asc" },
      include: { vendor: { select: { shop_name: true } } },
    });
    const phones = [...new Set(orders.map((o) => o.customer_phone).filter(Boolean))];
    const customers = phones.length
      ? await prisma.customer.findMany({
          where: { franchise_id: req.franchise_id, phone: { in: phones } },
        })
      : [];
    const byPhone = new Map(customers.map((c) => [c.phone, c]));

    ok(res, {
      orders: orders.map((order) => {
        const customer = byPhone.get(order.customer_phone);
        return {
          id: order.id,
          order_number: order.order_number,
          order_type: order.order_type,
          order_status: order.order_status,
          vendor_name: order.vendor?.shop_name ?? order.custom_shop_name ?? null,
          pickup_address: order.pickup_address,
          drop_address: order.drop_address,
          turning_point: order.turning_point ?? customer?.turning_point ?? null,
          drop_lat: coordStr(order.drop_lat),
          drop_lng: coordStr(order.drop_lng),
          amount_to_collect: moneyStr(order.amount_to_collect),
          payment_method: order.payment_method,
          customer_phone: order.customer_phone,
          voice_note_url: order.voice_note_url ?? customer?.voice_direction_url ?? null,
          house_image_url: customer?.house_image_url ?? null,
          rider_delivery_note: customer?.rider_delivery_note ?? null,
          location_token: order.location_token,
          created_at: order.created_at,
        };
      }),
    });
  })
);

const batchSchema = z.object({
  order_id: z.number().int().positive().max(MAX_ID),
  locations: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100000).optional(),
        timestamp: z.number().int().positive(),
      })
    )
    .min(1)
    .max(500),
});

// POST /api/v1/riders/location-batch — offline GPS flush (SPEC §50.1).
// Applied oldest-first through the same path as the socket event, so every
// point reaches the customer's tracking room once; replays are ignored.
router.post(
  "/location-batch",
  idempotency(),
  asyncHandler(async (req, res) => {
    const body = parse(batchSchema, req.body);
    const points = [...body.locations].sort((a, b) => a.timestamp - b.timestamp);
    const result = await applyRiderLocationBatch(req.rider, body.order_id, points);
    // The order is not this rider's (or no longer active): nothing was stored.
    if (result.accepted + result.duplicates === 0) throw orderNotFound();
    ok(res, result);
  })
);

// GET /api/v1/rider/earnings — deep link dropputt://rider/earnings (SPEC §51.1).
// Earnings per IST day for the last 30 days, from delivered orders plus
// milestone bonuses.
router.get(
  "/earnings",
  asyncHandler(async (req, res) => {
    const franchise_id = req.franchise_id;
    const rider = req.rider;
    const today = istDayRange();
    const since = new Date(today.start.getTime() - 29 * 24 * 60 * 60 * 1000);

    const [orders, bonuses] = await Promise.all([
      prisma.order.findMany({
        where: {
          franchise_id,
          rider_id: rider.id,
          order_status: "DELIVERED",
          delivered_at: { gte: since, lt: today.end },
        },
        select: { delivered_at: true, rider_earning: true, rider_tip: true },
      }),
      prisma.settlementEntry.findMany({
        where: {
          franchise_id,
          rider_id: rider.id,
          type: "MILESTONE_BONUS",
          created_at: { gte: since, lt: today.end },
        },
        select: { created_at: true, amount: true },
      }),
    ]);

    const days = new Map();
    for (let i = 29; i >= 0; i -= 1) {
      const date = istDayRange(new Date(today.start.getTime() - i * 24 * 60 * 60 * 1000)).date;
      days.set(date, { date, deliveries: 0, earning: money(0), tips: money(0), bonus: money(0) });
    }
    for (const order of orders) {
      const day = days.get(istDayRange(order.delivered_at).date);
      if (!day) continue;
      day.deliveries += 1;
      day.earning = addMoney(day.earning, order.rider_earning);
      day.tips = addMoney(day.tips, order.rider_tip);
    }
    for (const bonus of bonuses) {
      const day = days.get(istDayRange(bonus.created_at).date);
      if (day) day.bonus = addMoney(day.bonus, bonus.amount);
    }

    const list = [...days.values()];
    const sum = (rows) => ({
      deliveries: rows.reduce((n, d) => n + d.deliveries, 0),
      earning: moneyStr(addMoney(0, ...rows.map((d) => d.earning))),
      tips: moneyStr(addMoney(0, ...rows.map((d) => d.tips))),
      bonus: moneyStr(addMoney(0, ...rows.map((d) => d.bonus))),
    });
    ok(res, {
      wallet_earnings: moneyStr(rider.wallet_earnings),
      cash_in_hand: moneyStr(rider.cash_in_hand),
      today: sum(list.slice(-1)),
      last_7_days: sum(list.slice(-7)),
      last_30_days: sum(list),
      days: list.slice(-7).map((d) => ({
        date: d.date,
        deliveries: d.deliveries,
        earning: moneyStr(d.earning),
        tips: moneyStr(d.tips),
        bonus: moneyStr(d.bonus),
      })),
    });
  })
);

export default router;
