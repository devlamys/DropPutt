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
export function orderView(order) {
  return {
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    order_category: order.order_category,
    order_status: order.order_status,
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
    payment_method: order.payment_method,
    rain_surge_applied: order.rain_surge_applied,
    is_batched_addon: order.is_batched_addon,
    location_token: order.location_token,
    created_at: order.created_at,
    delivered_at: order.delivered_at,
  };
}
