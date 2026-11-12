// /api/v1/rider — the signed-in rider's own status (Rider app top bar).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, loadRider, requireRole } from "../middleware/auth.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { AppError, asyncHandler, ok } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { istDayRange } from "../utils/time.js";
import { parse } from "../utils/validate.js";

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

export default router;
