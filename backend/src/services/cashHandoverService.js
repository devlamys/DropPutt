// Rider → vendor cash handover. One place owns every change to
// rider.cash_in_hand that is not a delivery, so the rider app, the vendor
// app and the admin all go through the same locked transaction.
//
//   RIDER starts  → PENDING → vendor confirms → CONFIRMED (cash moves)
//   VENDOR starts → CONFIRMED immediately (the vendor is the receiver)
//   ADMIN direct  → CONFIRMED immediately, no vendor (franchise-held cash)
//
// Confirming lowers rider.cash_in_hand (which also lifts the cash-limit
// block, since the block is computed from it) and, for a vendor handover,
// lowers vendor.admin_payable_balance: the vendor already holds that cash,
// so the platform owes them that much less.

import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { audit } from "../utils/audit.js";
import { money, subtractMoney } from "../utils/orderMath.js";
import { pushToUsers } from "../utils/push.js";
import { AppError, validationError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";

export const handoverView = (row) => ({
  id: row.id,
  rider_id: row.rider_id,
  vendor_id: row.vendor_id,
  amount: moneyStr(row.amount),
  status: row.status,
  initiated_by: row.initiated_by,
  note: row.note,
  created_at: row.created_at,
  resolved_at: row.resolved_at,
  ...(row.rider?.user ? { rider_name: row.rider.user.name } : {}),
  ...(row.vendor ? { shop_name: row.vendor.shop_name } : {}),
});

export const handoverInclude = {
  rider: { select: { user_id: true, user: { select: { name: true } } } },
  vendor: { select: { user_id: true, shop_name: true } },
};

/**
 * Food money the rider collected on each vendor's COD orders and has not yet
 * handed over: Σ item_total (never more than the cash actually collected)
 * minus (pending + confirmed) handovers to that vendor. The delivery fee,
 * tip and surge are not the vendor's; they stay in the rider's cash_in_hand
 * and are settled with the franchise admin.
 * Returns [{ vendor_id, shop_name, owed }] with owed > 0 only.
 */
export async function cashOwedByVendor(db, franchise_id, rider_id) {
  const [collected, handed] = await Promise.all([
    db.$queryRaw`
      SELECT o.vendor_id AS vendor_id, SUM(LEAST(o.item_total, se.amount)) AS total
      FROM settlement_entries se
      JOIN orders o ON o.id = se.order_id
      WHERE se.franchise_id = ${franchise_id}
        AND se.rider_id = ${rider_id}
        AND se.party = 'RIDER_CASH'
        AND o.vendor_id IS NOT NULL
        AND o.payment_method = 'COD'
        AND o.rider_paid_at_shop = false
      GROUP BY o.vendor_id
    `,
    db.riderCashHandover.groupBy({
      by: ["vendor_id"],
      where: {
        franchise_id,
        rider_id,
        vendor_id: { not: null },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      _sum: { amount: true },
    }),
  ]);
  const handedBy = new Map(handed.map((row) => [row.vendor_id, money(row._sum.amount ?? 0)]));
  const rows = [];
  for (const row of collected) {
    const owed = subtractMoney(row.total, handedBy.get(row.vendor_id) ?? 0);
    if (owed.gt(0)) rows.push({ vendor_id: row.vendor_id, owed });
  }
  if (rows.length === 0) return [];
  const vendors = await db.vendor.findMany({
    where: { franchise_id, id: { in: rows.map((r) => r.vendor_id) } },
    select: { id: true, shop_name: true },
  });
  const names = new Map(vendors.map((v) => [v.id, v.shop_name]));
  return rows
    .filter((r) => names.has(r.vendor_id))
    .map((r) => ({ ...r, shop_name: names.get(r.vendor_id) }));
}

async function lockRider(tx, franchise_id, rider_id) {
  const locked = await tx.$queryRaw`
    SELECT id FROM "riders"
    WHERE id = ${rider_id} AND franchise_id = ${franchise_id}
    FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found in this franchise");
  }
  return tx.rider.findUnique({ where: { id: rider_id } });
}

/** Applies the money movement for a handover row. Caller holds the rider lock. */
async function applyMovement(tx, rider, handover, resolved_by) {
  const amount = money(handover.amount);
  if (amount.gt(rider.cash_in_hand)) {
    throw new AppError(
      409,
      "AMOUNT_EXCEEDS_CASH",
      `Amount is more than the rider's cash in hand (₹${moneyStr(rider.cash_in_hand)})`
    );
  }
  const cash_after = subtractMoney(rider.cash_in_hand, amount);
  await tx.rider.update({
    where: { id: rider.id },
    data: { cash_in_hand: moneyStr(cash_after) },
  });
  if (handover.vendor_id) {
    await tx.vendor.update({
      where: { id: handover.vendor_id },
      data: { admin_payable_balance: { decrement: moneyStr(amount) } },
    });
  }
  return tx.riderCashHandover.update({
    where: { id: handover.id },
    data: {
      status: "CONFIRMED",
      cash_before: moneyStr(rider.cash_in_hand),
      cash_after: moneyStr(cash_after),
      resolved_by,
      resolved_at: new Date(),
    },
    include: handoverInclude,
  });
}

function afterConfirmed(row, { franchise, requestId }) {
  const event = { handover_id: row.id, amount: moneyStr(row.amount), status: row.status };
  emitTo(rooms.rider(row.rider_id), "cash_settled", event);
  emitTo(rooms.franchise(row.franchise_id), "cash_settled", { ...event, rider_id: row.rider_id });
  if (row.vendor_id) emitTo(rooms.vendor(row.vendor_id), "cash_handover_resolved", event);
  pushToUsers([row.rider.user_id], {
    title: "✅ Cash settled",
    body: `₹${moneyStr(row.amount)} confirmed. You can accept orders again.`,
    data: {
      type: "CASH_SETTLED",
      franchise_slug: franchise.slug,
      deep_link: "dropputt://rider/home",
    },
    channel: "order_updates",
  });
  audit("rider.cash_handover_confirmed", {
    franchise_id: row.franchise_id,
    handover_id: row.id,
    rider_id: row.rider_id,
    vendor_id: row.vendor_id,
    amount: moneyStr(row.amount),
    initiated_by: row.initiated_by,
    cash_before: row.cash_before && moneyStr(row.cash_before),
    cash_after: row.cash_after && moneyStr(row.cash_after),
    request_id: requestId,
  });
}

/**
 * Starts a handover. RIDER → PENDING (vendor is asked). VENDOR / ADMIN →
 * applied immediately.
 */
export async function createHandover(
  { franchise, rider_id, vendor_id = null, amount, initiated_by, note, user_id },
  { requestId } = {}
) {
  const franchise_id = franchise.id;
  amount = money(amount);

  const row = await prisma.$transaction(async (tx) => {
    const rider = await lockRider(tx, franchise_id, rider_id);

    if (vendor_id) {
      const vendor = await tx.vendor.findFirst({ where: { id: vendor_id, franchise_id } });
      if (!vendor) throw new AppError(404, "VENDOR_NOT_FOUND", "Vendor not found in this franchise");
      const owed = (await cashOwedByVendor(tx, franchise_id, rider_id)).find(
        (r) => r.vendor_id === vendor_id
      );
      const available = owed?.owed ?? money(0);
      if (amount.gt(available)) {
        throw validationError("Request validation failed", [
          { field: "amount", issue: `exceeds cash owed to this vendor (₹${moneyStr(available)})` },
        ]);
      }
    }
    if (amount.gt(rider.cash_in_hand)) {
      throw validationError("Request validation failed", [
        { field: "amount", issue: `exceeds rider cash in hand (₹${moneyStr(rider.cash_in_hand)})` },
      ]);
    }

    const created = await tx.riderCashHandover.create({
      data: {
        franchise_id,
        rider_id,
        vendor_id,
        amount: moneyStr(amount),
        initiated_by,
        note: note ?? null,
      },
      include: handoverInclude,
    });
    if (initiated_by === "RIDER") return created;
    return applyMovement(tx, rider, created, user_id);
  }, TX_OPTIONS);

  if (row.status === "CONFIRMED") {
    afterConfirmed(row, { franchise, requestId });
  } else {
    const event = {
      handover_id: row.id,
      rider_name: row.rider.user.name,
      amount: moneyStr(row.amount),
    };
    emitTo(rooms.vendor(row.vendor_id), "cash_handover_requested", event);
    emitTo(rooms.franchise(franchise_id), "cash_handover_requested", { ...event, vendor_id });
    pushToUsers([row.vendor.user_id], {
      title: "💵 Cash from rider",
      body: `${row.rider.user.name} says they paid ₹${moneyStr(row.amount)}. Please confirm.`,
      data: {
        type: "CASH_HANDOVER_REQUESTED",
        handover_id: row.id,
        franchise_slug: franchise.slug,
        deep_link: "dropputt://vendor/home",
      },
      channel: "order_alerts",
    });
    audit("rider.cash_handover_requested", {
      franchise_id,
      handover_id: row.id,
      rider_id,
      vendor_id,
      amount: moneyStr(row.amount),
      request_id: requestId,
    });
  }
  return row;
}

/**
 * Resolves a PENDING handover. `scope` limits who may act: a vendor only on
 * their own rows (vendor_id), the franchise admin on any in the franchise.
 * Confirming twice is harmless: a CONFIRMED row is returned unchanged.
 */
export async function resolveHandover(
  { franchise, handover_id, action, vendor_id, user_id },
  { requestId } = {}
) {
  const franchise_id = franchise.id;
  const probe = await prisma.riderCashHandover.findFirst({
    where: { id: handover_id, franchise_id, ...(vendor_id ? { vendor_id } : {}) },
    select: { id: true, rider_id: true },
  });
  if (!probe) throw new AppError(404, "NOT_FOUND", "Cash handover not found");

  let changed = false;
  const row = await prisma.$transaction(async (tx) => {
    const rider = await lockRider(tx, franchise_id, probe.rider_id);
    const current = await tx.riderCashHandover.findUnique({
      where: { id: handover_id },
      include: handoverInclude,
    });
    if (current.status !== "PENDING") {
      const same =
        (action === "confirm" && current.status === "CONFIRMED") ||
        (action === "reject" && current.status === "REJECTED");
      if (same) return current;
      throw new AppError(409, "ALREADY_RESOLVED", `Handover is already ${current.status}`);
    }
    changed = true;
    if (action === "reject") {
      return tx.riderCashHandover.update({
        where: { id: handover_id },
        data: { status: "REJECTED", resolved_by: user_id, resolved_at: new Date() },
        include: handoverInclude,
      });
    }
    return applyMovement(tx, rider, current, user_id);
  }, TX_OPTIONS);

  if (changed && row.status === "CONFIRMED") {
    afterConfirmed(row, { franchise, requestId });
  } else if (changed) {
    emitTo(rooms.rider(row.rider_id), "cash_handover_rejected", {
      handover_id: row.id,
      amount: moneyStr(row.amount),
    });
    pushToUsers([row.rider.user_id], {
      title: "Cash not received",
      body: `${row.vendor?.shop_name ?? "Vendor"} did not confirm ₹${moneyStr(row.amount)}.`,
      data: { type: "CASH_HANDOVER_REJECTED", franchise_slug: franchise.slug },
      channel: "order_updates",
    });
    audit("rider.cash_handover_rejected", {
      franchise_id,
      handover_id: row.id,
      rider_id: row.rider_id,
      resolved_by: user_id,
      request_id: requestId,
    });
  }
  return row;
}
