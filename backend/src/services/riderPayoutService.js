// Rider earnings payout (§15.2). At delivery a rider keeps their earning out
// of the customer's cash; what could not be kept (UPI orders, milestone
// bonuses) sits in wallet_earnings until the franchise pays it here. A net
// settlement collects the rider's cash and pays the wallet in one go, so only
// the difference changes hands.

import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { audit } from "../utils/audit.js";
import { money, subtractMoney } from "../utils/orderMath.js";
import { pushToUsers } from "../utils/push.js";
import { AppError, validationError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";

export const payoutView = (row) => ({
  id: row.id,
  rider_id: row.rider_id,
  amount: moneyStr(row.amount),
  method: row.method,
  note: row.note,
  wallet_before: moneyStr(row.wallet_before),
  wallet_after: moneyStr(row.wallet_after),
  created_at: row.created_at,
});

async function lockRider(tx, franchise_id, rider_id) {
  const locked = await tx.$queryRaw`
    SELECT id FROM "riders"
    WHERE id = ${rider_id} AND franchise_id = ${franchise_id}
    FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found in this franchise");
  }
  return tx.rider.findUnique({ where: { id: rider_id }, include: { user: { select: { name: true } } } });
}

function notify(franchise, rider, { paid, collected }) {
  const event = {
    paid: moneyStr(paid),
    collected: moneyStr(collected),
  };
  emitTo(rooms.rider(rider.id), "earnings_paid", event);
  emitTo(rooms.franchise(franchise.id), "earnings_paid", { ...event, rider_id: rider.id });
  if (money(paid).gt(0)) {
    pushToUsers([rider.user_id], {
      title: "💰 Earnings paid",
      body: `The franchise paid you ₹${moneyStr(paid)}.`,
      data: { type: "EARNINGS_PAID", franchise_slug: franchise.slug, deep_link: "dropputt://rider/earnings" },
      channel: "earnings",
    });
  }
}

/** Pays part or all of a rider's wallet. */
export async function payRider({ franchise, rider_id, amount, method, note, user_id }, { requestId } = {}) {
  amount = money(amount);
  const { row, rider } = await prisma.$transaction(async (tx) => {
    const rider = await lockRider(tx, franchise.id, rider_id);
    const before = money(rider.wallet_earnings);
    if (amount.gt(before)) {
      throw validationError("Request validation failed", [
        { field: "amount", issue: `the franchise only owes this rider ₹${moneyStr(before)}` },
      ]);
    }
    const after = subtractMoney(before, amount);
    await tx.rider.update({ where: { id: rider_id }, data: { wallet_earnings: moneyStr(after) } });
    const row = await tx.riderPayout.create({
      data: {
        franchise_id: franchise.id,
        rider_id,
        amount: moneyStr(amount),
        method,
        note: note ?? null,
        wallet_before: moneyStr(before),
        wallet_after: moneyStr(after),
        recorded_by: user_id,
      },
    });
    return { row, rider };
  }, TX_OPTIONS);

  audit("rider.payout", {
    franchise_id: franchise.id,
    rider_id,
    payout_id: row.id,
    amount: moneyStr(row.amount),
    method,
    by_user_id: user_id,
    request_id: requestId,
  });
  notify(franchise, rider, { paid: row.amount, collected: 0 });
  return row;
}

/**
 * Net settlement: collect all cash in hand and pay all wallet earnings in one
 * transaction. Returns who hands whom the difference.
 */
export async function netSettleRider({ franchise, rider_id, note, user_id }, { requestId } = {}) {
  const result = await prisma.$transaction(async (tx) => {
    const rider = await lockRider(tx, franchise.id, rider_id);
    const cash = money(rider.cash_in_hand);
    const wallet = money(rider.wallet_earnings);
    if (cash.isZero() && wallet.isZero()) {
      throw new AppError(409, "NOTHING_TO_SETTLE", "This rider has no cash and no earnings to settle");
    }
    await tx.rider.update({
      where: { id: rider_id },
      data: { cash_in_hand: "0.00", wallet_earnings: "0.00" },
    });
    let handover = null;
    if (cash.gt(0)) {
      handover = await tx.riderCashHandover.create({
        data: {
          franchise_id: franchise.id,
          rider_id,
          vendor_id: null,
          amount: moneyStr(cash),
          status: "CONFIRMED",
          initiated_by: "ADMIN",
          cash_before: moneyStr(cash),
          cash_after: "0.00",
          note: note ?? "Net settlement",
          resolved_by: user_id,
          resolved_at: new Date(),
        },
      });
    }
    let payout = null;
    if (wallet.gt(0)) {
      payout = await tx.riderPayout.create({
        data: {
          franchise_id: franchise.id,
          rider_id,
          amount: moneyStr(wallet),
          method: "NETTED",
          note: note ?? "Net settlement",
          wallet_before: moneyStr(wallet),
          wallet_after: "0.00",
          recorded_by: user_id,
        },
      });
    }
    return { rider, cash, wallet, handover, payout };
  }, TX_OPTIONS);

  const net = subtractMoney(result.cash, result.wallet);
  audit("rider.net_settlement", {
    franchise_id: franchise.id,
    rider_id,
    cash_collected: moneyStr(result.cash),
    earnings_paid: moneyStr(result.wallet),
    net: moneyStr(net),
    handover_id: result.handover?.id ?? null,
    payout_id: result.payout?.id ?? null,
    by_user_id: user_id,
    request_id: requestId,
  });
  notify(franchise, result.rider, { paid: result.wallet, collected: result.cash });
  return {
    rider_id,
    cash_collected: moneyStr(result.cash),
    earnings_paid: moneyStr(result.wallet),
    // Positive: the rider hands this to the franchise. Negative: the franchise pays the rider.
    net: moneyStr(net),
    direction: net.gt(0) ? "RIDER_PAYS" : net.lt(0) ? "FRANCHISE_PAYS" : "EVEN",
  };
}
