// Order cancellation — one code path for the admin, the shop, the customer and
// the stale-order sweep.
//
// No money has moved before delivery: royalty, rider cash, rider earnings and
// the vendor payable are all written by the delivery transaction, so a
// cancelled order needs no ledger reversal. (A tip or rain surge only changes
// the order's own totals; the rider is never credited for a cancelled order.)

import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { audit } from "../utils/audit.js";
import { AppError, orderNotFound } from "../utils/response.js";
import { pushToUsers } from "../utils/push.js";

const BEFORE_PICKUP = ["RIDER_REQUESTED", "RIDER_ASSIGNED"];

/** Which statuses each actor may cancel from. */
export const CANCELLABLE_BY = Object.freeze({
  FRANCHISE_ADMIN: [...BEFORE_PICKUP, "PICKED_UP", "LOCATION_SHARED"],
  SYSTEM: ["RIDER_REQUESTED"],
  // A shop can withdraw until the rider has the food in hand.
  VENDOR: BEFORE_PICKUP,
  // A customer can change their mind only while no rider has taken the order.
  CUSTOMER: ["RIDER_REQUESTED"],
});

const DEFAULT_REASON = Object.freeze({
  FRANCHISE_ADMIN: "Cancelled by the franchise",
  SYSTEM: "No rider accepted in time",
  VENDOR: "Cancelled by the shop",
  CUSTOMER: "Cancelled by the customer",
});

const NOT_CANCELLABLE_MESSAGE = Object.freeze({
  DELIVERED: "This order has already been delivered",
  RIDER_ASSIGNED: "A rider has already accepted this order",
  PICKED_UP: "The rider has already picked this order up",
  LOCATION_SHARED: "The rider is already on the way",
});

/**
 * Cancels one order. Idempotent: cancelling an already-cancelled order returns
 * it with `already: true` and changes nothing.
 *
 * @param {object} args
 * @param {number} args.orderId
 * @param {number} args.franchise_id         tenant scope — always required
 * @param {"FRANCHISE_ADMIN"|"VENDOR"|"CUSTOMER"|"SYSTEM"} args.role
 * @param {number} [args.vendor_id]          required for VENDOR: only their own orders
 * @param {string} [args.reason]
 * @param {string} [args.franchise_slug]     for the push deep link
 */
export async function cancelOrder({ orderId, franchise_id, role, vendor_id, reason, franchise_slug }) {
  const allowed = CANCELLABLE_BY[role];
  if (!allowed) throw new Error(`cancelOrder: unknown role ${role}`);
  const cleanReason = (reason ?? "").trim().slice(0, 200) || DEFAULT_REASON[role];

  const { order, already, rider_user_id, vendor_user_id, was_status } = await prisma.$transaction(
    async (tx) => {
      // Same lock the accept endpoint takes: a rider accepting at this instant
      // and this cancel are serialised, so exactly one of them wins.
      const rows = await tx.$queryRaw`
        SELECT id FROM "orders"
        WHERE id = ${orderId} AND franchise_id = ${franchise_id}
        FOR UPDATE
      `;
      if (rows.length === 0) throw orderNotFound();

      const current = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          rider: { select: { user_id: true } },
          vendor: { select: { user_id: true } },
        },
      });
      if (role === "VENDOR" && current.vendor_id !== vendor_id) throw orderNotFound();

      if (current.order_status === "CANCELLED") {
        return { order: current, already: true, was_status: "CANCELLED" };
      }
      if (!allowed.includes(current.order_status)) {
        throw new AppError(
          409,
          "ORDER_NOT_CANCELLABLE",
          NOT_CANCELLABLE_MESSAGE[current.order_status] ?? "This order can no longer be cancelled"
        );
      }

      const order = await tx.order.update({
        where: { id: orderId },
        data: {
          order_status: "CANCELLED",
          cancelled_at: new Date(),
          cancelled_by_role: role,
          cancel_reason: cleanReason,
        },
      });
      audit("order.cancel", {
        franchise_id,
        order_id: orderId,
        by: role,
        from_status: current.order_status,
        reason: cleanReason,
      });
      return {
        order,
        already: false,
        was_status: current.order_status,
        rider_user_id: current.rider?.user_id ?? null,
        vendor_user_id: current.vendor?.user_id ?? null,
      };
    },
    TX_OPTIONS
  );

  if (!already) {
    const event = {
      order_id: order.id,
      order_number: order.order_number,
      order_status: "CANCELLED",
      cancelled_by_role: role,
      cancel_reason: order.cancel_reason,
    };
    // The customer's tracking page and every board refresh from this one event.
    emitTo(rooms.order(order.id), "order_status_changed", event);
    emitTo(rooms.franchise(franchise_id), "order_cancelled", event);
    if (order.vendor_id) emitTo(rooms.vendor(order.vendor_id), "order_cancelled", event);
    if (order.rider_id) emitTo(rooms.rider(order.rider_id), "order_cancelled", event);
    // Riders who were still being offered the order must lose the alarm.
    if (was_status === "RIDER_REQUESTED") {
      emitTo(rooms.franchiseRiders(franchise_id), "order_cancelled", event);
    }

    const data = {
      type: "ORDER_CANCELLED",
      order_id: order.id,
      franchise_slug: franchise_slug ?? "",
      deep_link: `dropputt://orders/${order.id}`,
    };
    const body = `Order #${order.order_number} was cancelled — ${order.cancel_reason}`;
    const targets = [];
    // Tell the other side, not the person who just pressed the button.
    if (rider_user_id) targets.push(rider_user_id);
    if (vendor_user_id && role !== "VENDOR") targets.push(vendor_user_id);
    if (targets.length) {
      await pushToUsers(targets, { title: "❌ Order cancelled", body, data, channel: "order_alerts" });
    }
  }

  return { order, already };
}
