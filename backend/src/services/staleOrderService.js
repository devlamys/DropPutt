// Stale-order sweep. Runs every few minutes (cron/staleOrders.js).
//
//   RIDER_REQUESTED, nobody accepted
//     ≥ redispatchAfter → ring the riders again (and tell the admin board)
//     ≥ autoCancelAfter → cancel it, so it never sits on the shop's board all night
//
//   RIDER_ASSIGNED / PICKED_UP / LOCATION_SHARED for hours
//     → only *reported* (admin overview `stuck_orders`); a rider may be holding
//       the goods, so a human decides.
//
// Every step is safe to repeat and safe to run on two replicas at once: the
// cancel takes the order row lock, and re-dispatch is gated by
// `last_dispatched_at`.

import { prisma } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { staleRules, minutesAgo } from "../utils/staleRules.js";
import { dispatchOrder } from "./dispatchService.js";
import { cancelOrder } from "./orderCancelService.js";

export async function sweepStaleOrders(now = new Date()) {
  const result = { cancelled: 0, redispatched: 0, failed: 0 };

  // 1. Give up on orders nobody took.
  const expired = await prisma.order.findMany({
    where: {
      order_status: "RIDER_REQUESTED",
      created_at: { lt: minutesAgo(now, staleRules.autoCancelAfterMinutes) },
    },
    select: { id: true, franchise_id: true, franchise: { select: { slug: true } } },
  });
  for (const order of expired) {
    try {
      const { already } = await cancelOrder({
        orderId: order.id,
        franchise_id: order.franchise_id,
        role: "SYSTEM",
        franchise_slug: order.franchise.slug,
      });
      if (!already) result.cancelled += 1;
    } catch (error) {
      // 409 = a rider accepted between the query and the lock: exactly what we want.
      if (error?.code !== "ORDER_NOT_CANCELLABLE") {
        result.failed += 1;
        console.error("[stale-orders] cancel failed for order", order.id, error.message);
      }
    }
  }

  // 2. Ring riders again for the ones still inside the window.
  const redispatchCutoff = minutesAgo(now, staleRules.redispatchAfterMinutes);
  const waiting = await prisma.order.findMany({
    where: {
      order_status: "RIDER_REQUESTED",
      created_at: { lt: redispatchCutoff },
      OR: [{ last_dispatched_at: null }, { last_dispatched_at: { lt: redispatchCutoff } }],
    },
    include: {
      franchise: { select: { slug: true } },
      vendor: { select: { shop_name: true } },
    },
  });
  for (const order of waiting) {
    try {
      // Claim first (compare-and-set), so a second replica skips this order.
      const claimed = await prisma.order.updateMany({
        where: {
          id: order.id,
          order_status: "RIDER_REQUESTED",
          OR: [{ last_dispatched_at: null }, { last_dispatched_at: { lt: redispatchCutoff } }],
        },
        data: { last_dispatched_at: now },
      });
      if (claimed.count === 0) continue;

      await dispatchOrder(order, {
        franchise_slug: order.franchise.slug,
        shop_name: order.vendor?.shop_name,
      });
      emitTo(rooms.franchise(order.franchise_id), "stale_order_alert", {
        order_id: order.id,
        order_number: order.order_number,
        waiting_minutes: Math.floor((now.getTime() - order.created_at.getTime()) / 60_000),
      });
      result.redispatched += 1;
    } catch (error) {
      result.failed += 1;
      console.error("[stale-orders] re-dispatch failed for order", order.id, error.message);
    }
  }

  return result;
}
