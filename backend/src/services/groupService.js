// "Deliver together" fee rules shared by checkout, cancellation and dispatch (SPEC "Deliver together").

import { dispatchOrder, itemCount } from "./dispatchService.js";
import { haversineMetres, isLatLng } from "../utils/geo.js";
import { money } from "../utils/orderMath.js";
import { moneyStr } from "../utils/serializers.js";

export const MAX_GROUP_SHOPS = 3;

/**
 * The trip costs the farthest shop's zone fee plus `extra_stop_fee` for every other shop.
 * Returns each entry's share: the farthest shop's order carries its zone fee, the others carry
 * the extra stop fee, so the shares add up to the trip fee and the rider keeps all of it.
 * `entries`: [{ zone_fee, km }] in any order; the result is aligned with it.
 */
export function allocateGroupFees(entries, extra_stop_fee) {
  let primary = 0;
  entries.forEach((entry, i) => {
    const best = entries[primary];
    const fee = money(entry.zone_fee);
    if (fee.gt(money(best.zone_fee)) || (fee.eq(money(best.zone_fee)) && Number(entry.km) > Number(best.km))) primary = i;
  });
  return entries.map((entry, i) => (i === primary ? money(entry.zone_fee) : money(extra_stop_fee)));
}

const STARTED = ["PICKED_UP", "LOCATION_SHARED", "DELIVERED"];

/** Road length is not stored; the straight line is only used to break a tie between equal zone fees. */
const kmOf = (order) =>
  isLatLng(order.pickup_lat, order.pickup_lng) && order.pickup_lat != null && order.drop_lat != null
    ? haversineMetres([Number(order.pickup_lat), Number(order.pickup_lng)], [Number(order.drop_lat), Number(order.drop_lng)]) / 1000
    : 0;

/**
 * Recomputes each order's share of the trip fee over the orders that are still in the group
 * (not cancelled). Orders already picked up keep the fee they were billed; the others get the
 * new share. Call inside the transaction that cancels an order of the group. Returns the id of
 * the group's lead order as it was BEFORE this call (so the caller knows the dispatched request
 * belonged to the order being cancelled), computed over every order of the group.
 */
export async function resplitGroupFees(tx, { franchise_id, group_id, cancelled_order_id }) {
  const all = await tx.order.findMany({
    where: { franchise_id, group_id },
    include: { zone: { select: { delivery_fee: true } } },
    orderBy: { id: "asc" },
  });
  const lead = all.reduce((best, o) => (Number(o.group_delivery_fee ?? 0) > Number(best.group_delivery_fee ?? 0) ? o : best), all[0]);
  const wasLead = lead?.id === cancelled_order_id;

  const left = all.filter((o) => o.order_status !== "CANCELLED" && o.id !== cancelled_order_id && o.zone);
  if (left.length === 0) return { wasLead };
  const franchise = await tx.franchise.findUnique({ where: { id: franchise_id }, select: { extra_stop_fee: true } });
  const shares = allocateGroupFees(left.map((o) => ({ zone_fee: o.zone.delivery_fee, km: kmOf(o) })), franchise.extra_stop_fee);
  for (let i = 0; i < left.length; i += 1) {
    if (STARTED.includes(left[i].order_status)) continue;
    if (String(left[i].group_delivery_fee) !== String(shares[i])) {
      await tx.order.update({ where: { id: left[i].id }, data: { group_delivery_fee: moneyStr(shares[i]) } });
    }
  }
  return { wasLead };
}

/**
 * The group's lead request was withdrawn before any rider took it: call riders again for the
 * orders that are still open, as one trip.
 */
export async function redispatchGroup(prisma, { franchise_id, group_id, franchise_slug }) {
  const open = await prisma.order.findMany({
    where: { franchise_id, group_id, order_status: "RIDER_REQUESTED" },
    include: { vendor: { select: { shop_name: true } }, items: true },
    orderBy: { id: "asc" },
  });
  if (open.length === 0) return;
  const lead = open.reduce((best, o) => (Number(o.group_delivery_fee ?? 0) > Number(best.group_delivery_fee ?? 0) ? o : best), open[0]);
  await dispatchOrder(lead, {
    franchise_slug,
    shop_name: open.map((o) => o.vendor?.shop_name ?? "Shop").join(" + "),
    item_count: open.reduce((n, o) => n + itemCount(o), 0),
    group_size: open.length,
  });
}
