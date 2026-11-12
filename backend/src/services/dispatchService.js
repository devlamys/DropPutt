// Rider dispatch for a freshly created order (SPEC §18 step 3).

import { prisma } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { ACTIVE_ORDER_STATUSES } from "../utils/constants.js";
import { pushToUsers } from "../utils/push.js";

/**
 * - Online, approved riders with zero active orders get `new_rider_request`.
 * - Riders already on a delivery, still under their max_active_orders, and
 *   whose active order shares this order's vendor or zone get
 *   `addon_order_alert`.
 *
 * Runs after the order transaction commits; failures are logged, never thrown.
 */
export async function dispatchOrder(order, { franchise_slug, shop_name } = {}) {
  try {
    const riders = await prisma.rider.findMany({
      where: {
        franchise_id: order.franchise_id,
        is_online: true,
        is_approved: true,
        user: { is_active: true },
        vehicle_type:
          order.order_type === "MINI_TRUCK" ? "MINI_TRUCK" : { not: "MINI_TRUCK" },
      },
      select: {
        id: true,
        user_id: true,
        max_active_orders: true,
        cash_in_hand: true,
        max_cash_limit: true,
      },
    });
    const eligible = riders.filter((rider) => rider.cash_in_hand.lt(rider.max_cash_limit));
    if (eligible.length === 0) return { requested: 0, addon: 0 };

    const activeOrders = await prisma.order.findMany({
      where: {
        franchise_id: order.franchise_id,
        rider_id: { in: eligible.map((rider) => rider.id) },
        order_status: { in: ACTIVE_ORDER_STATUSES },
      },
      select: { rider_id: true, vendor_id: true, zone_id: true },
    });
    const activeByRider = new Map();
    for (const active of activeOrders) {
      const list = activeByRider.get(active.rider_id) || [];
      list.push(active);
      activeByRider.set(active.rider_id, list);
    }

    const request = {
      order_id: order.id,
      order_number: order.order_number,
      order_type: order.order_type,
      shop_name: shop_name ?? order.custom_shop_name ?? null,
      pickup_address: order.pickup_address,
      drop_address: order.drop_address,
      zone_id: order.zone_id,
    };
    const requestedUsers = [];
    const addonUsers = [];

    for (const rider of eligible) {
      const active = activeByRider.get(rider.id) || [];
      if (active.length === 0) {
        emitTo(rooms.rider(rider.id), "new_rider_request", request);
        requestedUsers.push(rider.user_id);
        continue;
      }
      const onRoute = active.some(
        (other) =>
          (order.vendor_id !== null && other.vendor_id === order.vendor_id) ||
          (order.zone_id !== null && other.zone_id === order.zone_id)
      );
      if (active.length < rider.max_active_orders && onRoute) {
        emitTo(rooms.rider(rider.id), "addon_order_alert", {
          order_id: order.id,
          message: "🔥 Add-on Order on your route!",
        });
        addonUsers.push(rider.user_id);
      }
    }

    const data = {
      order_id: order.id,
      franchise_slug: franchise_slug ?? "",
      deep_link: `dropputt://orders/${order.id}`,
    };
    const body = `Order #${order.order_number}${request.shop_name ? ` from ${request.shop_name}` : ""}`;
    await Promise.all([
      pushToUsers(requestedUsers, {
        title: "🛵 New Order!",
        body,
        data: { ...data, type: "NEW_ORDER" },
        channel: "order_alerts",
      }),
      pushToUsers(addonUsers, {
        title: "🔥 Add-on Order!",
        body,
        data: { ...data, type: "ADDON_ORDER" },
        channel: "order_alerts",
      }),
    ]);

    return { requested: requestedUsers.length, addon: addonUsers.length };
  } catch (error) {
    console.error("[dispatch] failed for order", order.id, error.message);
    return { requested: 0, addon: 0 };
  }
}
