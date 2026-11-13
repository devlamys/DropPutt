// Production reconciliation (SPEC §41).
//
// Every delivered order is checked two ways:
//   1. split identity — the four-way split must account for the whole
//      grand total, apart from the documented pass-through amounts;
//   2. ledger — each SettlementEntry / WalletTransaction written at delivery
//      must agree with the amount stored on the Order.
// Balances kept on Rider / Vendor / Franchise are compared with the sum of
// their ledger rows, because mutable aggregates must never be trusted alone.

import { prisma } from "../config/prisma.js";
import {
  addMoney,
  calculateCashInHandIncrease,
  money,
  subtractMoney,
} from "../utils/orderMath.js";
import { validationError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { istDayRange } from "../utils/time.js";

const MAX_DAYS = 31;
const SCAN_LIMIT = 5000;
const BATCH = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (IST, inclusive). Defaults to today. */
export function parseRange(query) {
  const today = istDayRange().date;
  const from = query.from ?? query.to ?? today;
  const to = query.to ?? from;
  for (const [field, value] of [["from", from], ["to", to]]) {
    // Round-trip through the IST calendar so impossible dates (2026-02-30)
    // are rejected instead of silently rolling into the next month.
    const parsed = DATE.test(value) ? new Date(`${value}T00:00:00+05:30`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || istDayRange(parsed).date !== value) {
      throw validationError("Request validation failed", [
        { field, issue: "must be a date like 2026-11-30" },
      ]);
    }
  }
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 24 * 60 * 60 * 1000);
  if (end <= start) {
    throw validationError("Request validation failed", [{ field: "to", issue: "must not be before from" }]);
  }
  if ((end - start) / 86_400_000 > MAX_DAYS) {
    throw validationError("Request validation failed", [
      { field: "to", issue: `range is limited to ${MAX_DAYS} days` },
    ]);
  }
  return { from, to, start, end };
}

const ORDER_SELECT = {
  id: true,
  order_number: true,
  order_type: true,
  payment_method: true,
  vendor_id: true,
  rider_id: true,
  rider_paid_at_shop: true,
  delivered_at: true,
  settlement_completed: true,
  royalty_deducted: true,
  item_total: true,
  delivery_fee: true,
  rider_tip: true,
  discount_amount: true,
  shop_markup_profit: true,
  grand_total: true,
  vendor_commission: true,
  vendor_earning: true,
  rider_earning: true,
  franchise_profit: true,
  super_admin_profit: true,
  amount_to_collect: true,
  vendor_admin_payable: true,
};

/**
 * Loads the ledger rows for a set of orders and returns, per order, the list
 * of discrepancies found (empty list = reconciled).
 */
export async function checkOrders(orders) {
  const ids = orders.map((o) => o.id);
  const [entries, debits] = await Promise.all([
    prisma.settlementEntry.findMany({
      where: { order_id: { in: ids } },
      select: { order_id: true, reference_key: true, amount: true },
    }),
    prisma.walletTransaction.findMany({
      where: { order_id: { in: ids }, type: "DEBIT" },
      select: { order_id: true, amount: true },
    }),
  ]);
  const entryByKey = new Map(entries.map((e) => [e.reference_key, e.amount]));
  const debitByOrder = new Map();
  for (const d of debits) {
    debitByOrder.set(d.order_id, addMoney(debitByOrder.get(d.order_id) ?? 0, d.amount));
  }

  const result = new Map();
  for (const order of orders) {
    const issues = [];
    const add = (code, message, expected, actual) =>
      issues.push({
        code,
        message,
        expected: expected == null ? null : moneyStr(expected),
        actual: actual == null ? null : moneyStr(actual),
      });
    const key = (suffix) => `order:${order.id}:${suffix}`;

    if (!order.settlement_completed) {
      add("NOT_SETTLED", "Delivered but settlement is not marked complete");
      result.set(order.id, issues);
      continue;
    }

    // 1. Split identity. A partner-vendor order allocates item + fee + tip +
    //    markup across the four parties (the discount is a customer saving);
    //    with no partner vendor the shop purchase itself is not split.
    const allocated = addMoney(
      order.vendor_earning,
      order.rider_earning,
      order.franchise_profit,
      order.super_admin_profit
    );
    const passThrough = order.vendor_id ? money(0) : money(order.item_total);
    const expectedUnallocated = subtractMoney(
      passThrough,
      order.discount_amount,
      order.shop_markup_profit
    );
    const unallocated = subtractMoney(order.grand_total, allocated);
    if (!unallocated.eq(expectedUnallocated)) {
      add(
        "SPLIT_MISMATCH",
        "Vendor + rider + franchise + royalty do not account for the grand total",
        expectedUnallocated,
        unallocated
      );
    }

    // 2. Ledger rows against the order.
    const expectEntry = (suffix, label, expected) => {
      const actual = entryByKey.get(key(suffix));
      if (actual === undefined) add("MISSING_ENTRY", `${label} entry is missing`, expected, null);
      else if (!money(actual).eq(expected)) {
        add("AMOUNT_MISMATCH", `${label} entry differs from the order`, expected, actual);
      }
    };
    expectEntry("rider-earning", "Rider earning", money(order.rider_earning));
    expectEntry("franchise-profit", "Franchise profit", money(order.franchise_profit));
    expectEntry("royalty", "Royalty", money(order.super_admin_profit));
    if (order.vendor_id) expectEntry("vendor-payable", "Vendor payable", money(order.vendor_admin_payable));
    const cash = calculateCashInHandIncrease(order);
    if (cash.gt(0)) expectEntry("cash-collection", "Cash collection", cash);

    const debit = debitByOrder.get(order.id);
    if (debit === undefined) add("MISSING_ENTRY", "Royalty wallet debit is missing", order.super_admin_profit, null);
    else if (!money(debit).eq(order.super_admin_profit)) {
      add("AMOUNT_MISMATCH", "Royalty wallet debit differs from the order", order.super_admin_profit, debit);
    }
    if (!order.royalty_deducted) add("ROYALTY_FLAG", "royalty_deducted is false on a settled order");

    result.set(order.id, issues);
  }
  return result;
}

export const orderRow = (order, issues = []) => ({
  id: order.id,
  order_number: order.order_number,
  order_type: order.order_type,
  payment_method: order.payment_method,
  delivered_at: order.delivered_at,
  grand_total: moneyStr(order.grand_total),
  amount_to_collect: moneyStr(order.amount_to_collect),
  vendor_earning: moneyStr(order.vendor_earning),
  vendor_payable: order.vendor_id ? moneyStr(order.vendor_admin_payable) : null,
  rider_earning: moneyStr(order.rider_earning),
  franchise_profit: moneyStr(order.franchise_profit),
  super_admin_profit: moneyStr(order.super_admin_profit),
  discount_amount: moneyStr(order.discount_amount),
  reconciled: issues.length === 0,
  issues,
});

const deliveredWhere = (franchise_id, range) => ({
  franchise_id,
  order_status: "DELIVERED",
  delivered_at: { gte: range.start, lt: range.end },
});

/** Totals, payment-method split, order-level discrepancies and balance checks. */
export async function buildReconciliation(franchise_id, range) {
  const where = deliveredWhere(franchise_id, range);

  const [sums, byPayment, milestones, cashEntries] = await Promise.all([
    prisma.order.aggregate({
      where,
      _count: { _all: true },
      _sum: {
        item_total: true,
        delivery_fee: true,
        rider_tip: true,
        discount_amount: true,
        grand_total: true,
        vendor_commission: true,
        vendor_earning: true,
        rider_earning: true,
        franchise_profit: true,
        super_admin_profit: true,
        vendor_admin_payable: true,
      },
    }),
    prisma.order.groupBy({
      by: ["payment_method"],
      where,
      _count: { _all: true },
      _sum: { grand_total: true, amount_to_collect: true },
    }),
    prisma.settlementEntry.aggregate({
      where: {
        franchise_id,
        type: "MILESTONE_BONUS",
        created_at: { gte: range.start, lt: range.end },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.settlementEntry.aggregate({
      where: {
        franchise_id,
        party: "RIDER_CASH",
        created_at: { gte: range.start, lt: range.end },
      },
      _sum: { amount: true },
    }),
  ]);

  // Order-level scan (bounded).
  const discrepancies = [];
  let scanned = 0;
  let flagged = 0;
  let cursor = 0;
  while (scanned < SCAN_LIMIT) {
    const batch = await prisma.order.findMany({
      where: { ...where, id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: BATCH,
      select: ORDER_SELECT,
    });
    if (batch.length === 0) break;
    const checked = await checkOrders(batch);
    for (const order of batch) {
      const issues = checked.get(order.id) ?? [];
      if (issues.length) {
        flagged += 1;
        if (discrepancies.length < 100) {
          discrepancies.push({ order_id: order.id, order_number: order.order_number, issues });
        }
      }
    }
    scanned += batch.length;
    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH) break;
  }

  const total = (field) => moneyStr(sums._sum[field] ?? 0);
  return {
    range: { from: range.from, to: range.to },
    totals: {
      orders: sums._count._all,
      grand_total: total("grand_total"),
      item_total: total("item_total"),
      delivery_fee: total("delivery_fee"),
      rider_tips: total("rider_tip"),
      discounts: total("discount_amount"),
      vendor_commission: total("vendor_commission"),
      vendor_earning: total("vendor_earning"),
      vendor_payable_net: total("vendor_admin_payable"),
      rider_earning: total("rider_earning"),
      milestone_bonuses: moneyStr(milestones._sum.amount ?? 0),
      franchise_profit: total("franchise_profit"),
      super_admin_royalty: total("super_admin_profit"),
      cash_collected_by_riders: moneyStr(cashEntries._sum.amount ?? 0),
    },
    by_payment_method: byPayment.map((row) => ({
      payment_method: row.payment_method,
      orders: row._count._all,
      grand_total: moneyStr(row._sum.grand_total ?? 0),
      amount_to_collect: moneyStr(row._sum.amount_to_collect ?? 0),
    })),
    check: {
      orders_scanned: scanned,
      truncated: scanned >= SCAN_LIMIT,
      orders_with_issues: flagged,
      discrepancies,
    },
    balances: await balanceChecks(franchise_id),
  };
}

/** Stored balances vs. their ledger rows (all time). */
async function balanceChecks(franchise_id) {
  const [franchise, lastTx, riders, vendors, riderLedger, vendorLedger] = await Promise.all([
    prisma.franchise.findUnique({ where: { id: franchise_id }, select: { wallet_balance: true } }),
    prisma.walletTransaction.findFirst({
      where: { franchise_id },
      orderBy: { id: "desc" },
      select: { balance_after: true },
    }),
    prisma.rider.findMany({
      where: { franchise_id },
      select: { id: true, wallet_earnings: true, user: { select: { name: true } } },
    }),
    prisma.vendor.findMany({
      where: { franchise_id },
      select: { id: true, shop_name: true, admin_payable_balance: true },
    }),
    // RIDER_TIP / RAIN_SURGE rows are informational: the amount reaches the
    // wallet inside the ORDER_DELIVERY entry, so they are left out.
    prisma.settlementEntry.groupBy({
      by: ["rider_id"],
      where: {
        franchise_id,
        party: "RIDER_EARNING",
        type: { in: ["ORDER_DELIVERY", "MILESTONE_BONUS"] },
      },
      _sum: { amount: true },
    }),
    prisma.settlementEntry.groupBy({
      by: ["vendor_id"],
      where: { franchise_id, party: "VENDOR_PAYABLE" },
      _sum: { amount: true },
    }),
  ]);

  const riderSums = new Map(riderLedger.map((row) => [row.rider_id, row._sum.amount]));
  const vendorSums = new Map(vendorLedger.map((row) => [row.vendor_id, row._sum.amount]));
  const compare = (stored, ledger) => ({
    stored: moneyStr(stored),
    ledger: moneyStr(ledger),
    matches: money(stored).eq(money(ledger)),
  });
  return {
    franchise_wallet: lastTx
      ? compare(franchise.wallet_balance, lastTx.balance_after)
      : { stored: moneyStr(franchise.wallet_balance), ledger: null, matches: true },
    riders: riders.map((rider) => ({
      id: rider.id,
      name: rider.user.name,
      ...compare(rider.wallet_earnings, riderSums.get(rider.id) ?? 0),
    })),
    vendors: vendors.map((vendor) => ({
      id: vendor.id,
      shop_name: vendor.shop_name,
      ...compare(vendor.admin_payable_balance, vendorSums.get(vendor.id) ?? 0),
    })),
  };
}

/** One page of delivered orders with their per-order check. */
export async function reconciliationOrders(franchise_id, range, { limit, cursorId }) {
  const rows = await prisma.order.findMany({
    where: { ...deliveredWhere(franchise_id, range), ...(cursorId ? { id: { lt: cursorId } } : {}) },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: ORDER_SELECT,
  });
  return rows;
}
