// Rider dispatch for a freshly created order (SPEC §18 step 3).

import { prisma } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { ACTIVE_ORDER_STATUSES } from "../utils/constants.js";
import { haversineMetres, isLatLng } from "../utils/geo.js";
import { pushToUsers } from "../utils/push.js";

/** [{ name, quantity }] for the order's lines (empty for custom / quick-call orders). */
export function itemSummary(order) {
  return (order.items ?? []).map((item) => ({
    name: item.product?.name ?? "Item",
    quantity: item.quantity,
  }));
}

const itemLine = (item) => `${item.quantity}× ${item.name}`;

/** Total pieces ordered (2 biryani + 1 meals = 3): all a rider is told before accepting. */
export const itemCount = (order) => (order.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
const itemsLabel = (count) => `${count} item${count === 1 ? "" : "s"}`;

/** Two drop points this close are the same house, the same shop front or the same lane. */
export const SAME_DROP_METRES = 150;

/**
 * True when `a` and `b` are for the same customer: the same phone, or drops within
 * SAME_DROP_METRES of each other (a family ordering from two phones, or two shops).
 * Only used to offer a rider the second order; it never merges orders or money.
 */
export function isSameCustomer(a, b) {
  if (a.customer_phone && b.customer_phone && a.customer_phone === b.customer_phone) return true;
  // Number(null) is 0, so a missing drop point must be ruled out before isLatLng.
  const hasDrop = (o) => o.drop_lat != null && o.drop_lng != null && isLatLng(o.drop_lat, o.drop_lng);
  if (!hasDrop(a) || !hasDrop(b)) return false;
  return haversineMetres([Number(a.drop_lat), Number(a.drop_lng)], [Number(b.drop_lat), Number(b.drop_lng)]) <= SAME_DROP_METRES;
}

/**
 * - Online, approved riders with zero active orders get `new_rider_request`.
 * - Riders already on a delivery, still under their max_active_orders, and
 *   whose active order shares this order's vendor or zone, or is for the same
 *   customer (same phone or drop within 150 m), get `addon_order_alert`. For the
 *   same customer the alert says so (`same_customer: true`): one trip drops both.
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
      select: { rider_id: true, vendor_id: true, zone_id: true, order_number: true, customer_phone: true, drop_lat: true, drop_lng: true },
    });
    const activeByRider = new Map();
    for (const active of activeOrders) {
      const list = activeByRider.get(active.rider_id) || [];
      list.push(active);
      activeByRider.set(active.rider_id, list);
    }

    // Before accepting, a rider sees only how many items there are; the list
    // itself appears once the order is theirs (SPEC §62.1).
    const item_count = itemCount(order);

    const request = {
      order_id: order.id,
      order_number: order.order_number,
      order_type: order.order_type,
      shop_name: shop_name ?? order.custom_shop_name ?? null,
      pickup_address: order.pickup_address,
      drop_address: order.drop_address,
      zone_id: order.zone_id,
      item_count,
    };
    const requestedUsers = [];
    const addonUsers = [];
    const sameCustomerUsers = [];

    for (const rider of eligible) {
      const active = activeByRider.get(rider.id) || [];
      if (active.length === 0) {
        emitTo(rooms.rider(rider.id), "new_rider_request", request);
        requestedUsers.push(rider.user_id);
        continue;
      }
      const sameCustomerAs = active.find((other) => isSameCustomer(order, other));
      const onRoute = Boolean(sameCustomerAs) || active.some(
        (other) =>
          (order.vendor_id !== null && other.vendor_id === order.vendor_id) ||
          (order.zone_id !== null && other.zone_id === order.zone_id)
      );
      if (active.length < rider.max_active_orders && onRoute) {
        emitTo(rooms.rider(rider.id), "addon_order_alert", {
          order_id: order.id,
          message: sameCustomerAs
            ? `🔥 Same customer as your order #${sameCustomerAs.order_number}: deliver both in one trip`
            : "🔥 Add-on Order on your route!",
          same_customer: Boolean(sameCustomerAs),
          order_number: order.order_number,
          shop_name: request.shop_name,
          pickup_address: order.pickup_address,
          item_count,
        });
        (sameCustomerAs ? sameCustomerUsers : addonUsers).push(rider.user_id);
      }
    }

    const data = {
      order_id: order.id,
      franchise_slug: franchise_slug ?? "",
      deep_link: `dropputt://orders/${order.id}`,
      web_path: "/rider",
    };
    const body =
      `Order #${order.order_number}${request.shop_name ? ` from ${request.shop_name}` : ""}` +
      (item_count > 0 ? ` — ${itemsLabel(item_count)}` : "");
    await Promise.all([
      pushToUsers(requestedUsers, {
        title: "🛵 New Order!",
        body,
        data: { ...data, type: "NEW_ORDER" },
        channel: "order_alerts",
      }),
      pushToUsers(sameCustomerUsers, {
        title: "🔥 Same customer!",
        body: `${body} — deliver together with your current order`,
        data: { ...data, type: "ADDON_ORDER" },
        channel: "order_alerts",
      }),
      pushToUsers(addonUsers, {
        title: "🔥 Add-on Order!",
        body,
        data: { ...data, type: "ADDON_ORDER" },
        channel: "order_alerts",
      }),
    ]);

    return { requested: requestedUsers.length, addon: addonUsers.length + sameCustomerUsers.length };
  } catch (error) {
    console.error("[dispatch] failed for order", order.id, error.message);
    return { requested: 0, addon: 0 };
  }
}

/**
 * Tells the shop about a customer's new order: a socket event for the open
 * dashboard (loud alert) and a push for a closed one. Shops that do not use the
 * app are skipped: their rider is told the items instead (see dispatchOrder).
 * Failures are logged, never thrown.
 */
export async function notifyVendorNewOrder(order, vendor, { franchise_slug } = {}) {
  try {
    if (!vendor?.app_enabled) return false;
    const items = itemSummary(order);
    emitTo(rooms.vendor(vendor.id), "new_order_for_vendor", {
      order_id: order.id,
      order_number: order.order_number,
      payment_method: order.payment_method,
      items,
    });
    const lines = items.map(itemLine);
    const shown = lines.slice(0, 4).join(", ");
    await pushToUsers([vendor.user_id], {
      title: "🔔 New Order!",
      body: `#${order.order_number} — ${shown}${lines.length > 4 ? ` +${lines.length - 4} more` : ""}`,
      data: {
        type: "VENDOR_NEW_ORDER",
        order_id: order.id,
        franchise_slug: franchise_slug ?? "",
        deep_link: `dropputt://vendor/orders/${order.id}`,
        web_path: "/vendor",
      },
      channel: "order_alerts",
    });
    return true;
  } catch (error) {
    console.error("[dispatch] vendor notify failed for order", order.id, error.message);
    return false;
  }
}
