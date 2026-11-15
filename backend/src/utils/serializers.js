import Decimal from "decimal.js";
import { money } from "./orderMath.js";

/** Money → "120.00" (string, for JSON and for Prisma Decimal writes). */
export const moneyStr = (value) =>
  value === null || value === undefined ? null : money(value).toFixed(2);

/** Coordinate → "11.0001234". */
export const coordStr = (value) =>
  value === null || value === undefined
    ? null
    : new Decimal(value.toString()).toFixed(7);

/**
 * Order as seen by the rider / vendor / franchise staff. Deliberately omits
 * franchise_profit and super_admin_profit.
 */
/** Cash the rider hands the vendor: the food money of a COD order, never the delivery fee. */
export function payToVendor(order) {
  if (!order.vendor_id || order.payment_method !== "COD" || order.rider_paid_at_shop) return 0;
  const food = Number(order.item_total);
  const collect = Number(order.amount_to_collect);
  return Math.min(food, collect);
}

/** True when the vendor order was priced without commission (rate stored as 0 at pickup). */
export const isCommissionFreeOrder = (order) =>
  Boolean(order.vendor_id) && order.commission_rate !== null && order.commission_rate !== undefined && Number(order.commission_rate) === 0;

export function orderView(order) {
  return {
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    order_category: order.order_category,
    order_status: order.order_status,
    channel: order.channel,
    vendor_id: order.vendor_id,
    rider_id: order.rider_id,
    zone_id: order.zone_id,
    customer_phone: order.customer_phone,
    customer_name: order.customer_name,
    custom_shop_name: order.custom_shop_name,
    custom_items_text: order.custom_items_text,
    rider_paid_at_shop: order.rider_paid_at_shop,
    bill_image_url: order.bill_image_url,
    voice_note_url: order.voice_note_url,
    // What the customer asked a rider to buy: list photo / prescription and a voice note.
    request_image_url: order.prescription_img_url,
    request_voice_url: order.request_voice_url,
    pickup_address: order.pickup_address,
    pickup_lat: coordStr(order.pickup_lat),
    pickup_lng: coordStr(order.pickup_lng),
    drop_address: order.drop_address,
    turning_point: order.turning_point,
    drop_lat: coordStr(order.drop_lat),
    drop_lng: coordStr(order.drop_lng),
    item_total: moneyStr(order.item_total),
    delivery_fee: moneyStr(order.delivery_fee),
    rider_tip: moneyStr(order.rider_tip),
    discount_amount: moneyStr(order.discount_amount),
    grand_total: moneyStr(order.grand_total),
    amount_to_collect: moneyStr(order.amount_to_collect),
    rider_earning: moneyStr(order.rider_earning),
    // Bill breakdown for the rider (§10.1): what to hand the hotel, and the
    // commission the hotel settles with the franchise (0 for Call Rider Now).
    vendor_commission: moneyStr(order.vendor_commission),
    commission_free: isCommissionFreeOrder(order),
    pay_vendor: moneyStr(payToVendor(order)),
    // §14.4: delivery fee the hotel hands the rider at pickup.
    collect_from_hotel: order.payment_method === "PREPAID_FULL_AT_HOTEL" ? moneyStr(order.delivery_fee) : "0.00",
    payment_method: order.payment_method,
    rain_surge_applied: order.rain_surge_applied,
    is_batched_addon: order.is_batched_addon,
    location_token: order.location_token,
    created_at: order.created_at,
    delivered_at: order.delivered_at,
    cancelled_at: order.cancelled_at ?? null,
    cancelled_by_role: order.cancelled_by_role ?? null,
    cancel_reason: order.cancel_reason ?? null,
  };
}
