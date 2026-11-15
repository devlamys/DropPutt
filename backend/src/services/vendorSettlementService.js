// Franchise ↔ hotel settlement (§16.1). The franchise admin records a payment
// made in cash / UPI / bank; the vendor's signed admin_payable_balance moves
// towards zero. Positive = the franchise owes the hotel; negative = the hotel
// owes the franchise (storefront commission).

import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { audit } from "../utils/audit.js";
import { addMoney, money, subtractMoney } from "../utils/orderMath.js";
import { pushToUsers } from "../utils/push.js";
import { AppError, validationError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";

export const settlementView = (row) => ({
  id: row.id,
  vendor_id: row.vendor_id,
  direction: row.direction,
  amount: moneyStr(row.amount),
  method: row.method,
  note: row.note,
  period_from: row.period_from,
  period_to: row.period_to,
  balance_before: moneyStr(row.balance_before),
  balance_after: moneyStr(row.balance_after),
  created_at: row.created_at,
});

export async function recordVendorSettlement(
  { franchise, vendor_id, direction, amount, method, note, period_from, period_to, user_id },
  { requestId } = {}
) {
  const franchise_id = franchise.id;
  amount = money(amount);

  const row = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`
      SELECT id FROM "vendors"
      WHERE id = ${vendor_id} AND franchise_id = ${franchise_id}
      FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppError(404, "VENDOR_NOT_FOUND", "Vendor not found in this franchise");
    }
    const vendor = await tx.vendor.findUnique({ where: { id: vendor_id } });
    const before = money(vendor.admin_payable_balance);

    // The payment must not push the balance past zero.
    if (direction === "VENDOR_PAID_FRANCHISE") {
      const owed = before.isNegative() ? before.negated() : money(0);
      if (amount.gt(owed)) {
        throw validationError("Request validation failed", [
          { field: "amount", issue: `the hotel only owes ₹${moneyStr(owed)}` },
        ]);
      }
    } else {
      const owed = before.isPositive() ? before : money(0);
      if (amount.gt(owed)) {
        throw validationError("Request validation failed", [
          { field: "amount", issue: `the franchise only owes ₹${moneyStr(owed)}` },
        ]);
      }
    }
    const after =
      direction === "VENDOR_PAID_FRANCHISE" ? addMoney(before, amount) : subtractMoney(before, amount);

    await tx.vendor.update({
      where: { id: vendor_id },
      data: { admin_payable_balance: moneyStr(after) },
    });
    return tx.vendorSettlement.create({
      data: {
        franchise_id,
        vendor_id,
        direction,
        amount: moneyStr(amount),
        method,
        note: note ?? null,
        period_from: period_from ?? null,
        period_to: period_to ?? null,
        balance_before: moneyStr(before),
        balance_after: moneyStr(after),
        recorded_by: user_id,
      },
      include: { vendor: { select: { user_id: true, shop_name: true } } },
    });
  }, TX_OPTIONS);

  emitTo(rooms.vendor(vendor_id), "vendor_settlement_recorded", {
    settlement_id: row.id,
    direction: row.direction,
    amount: moneyStr(row.amount),
    balance_after: moneyStr(row.balance_after),
  });
  pushToUsers([row.vendor.user_id], {
    title: row.direction === "VENDOR_PAID_FRANCHISE" ? "✅ Payment received" : "💵 Payment sent",
    body:
      row.direction === "VENDOR_PAID_FRANCHISE"
        ? `Franchise recorded ₹${moneyStr(row.amount)} received from you.`
        : `Franchise recorded ₹${moneyStr(row.amount)} paid to you.`,
    data: { type: "VENDOR_SETTLEMENT", franchise_slug: franchise.slug, deep_link: "dropputt://vendor/history" },
    channel: "order_updates",
  });
  audit("vendor.settlement_recorded", {
    franchise_id,
    settlement_id: row.id,
    vendor_id,
    direction,
    amount: moneyStr(row.amount),
    balance_before: moneyStr(row.balance_before),
    balance_after: moneyStr(row.balance_after),
    recorded_by: user_id,
    request_id: requestId,
  });
  return row;
}
