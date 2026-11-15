import crypto from "node:crypto";
import assert from "node:assert/strict";
import { prisma } from "./app.js";
import { nextPhone } from "./fixtures.js";

export const uuid = () => crypto.randomUUID();

/**
 * Vendor calls a rider with an itemised cart. Returns the created order.
 * A vendor-started call is a commission-free HOTEL_DIRECT order (§10.1). By
 * default the order is re-typed FOOD_MARKETPLACE so it behaves like a
 * storefront order (commission + royalty); pass { storefront: false } to keep
 * the real "Call Rider Now" behaviour.
 */
export async function placeOrder(api, w, { items, phone = nextPhone(), storefront = true } = {}) {
  const res = await api("POST", "/orders/quick-call", {
    token: w.vendorToken,
    headers: { "Idempotency-Key": uuid() },
    body: {
      customer_phone: phone,
      items: items ?? [{ product_id: w.products.biryani.id, quantity: 2 }],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const order = res.body.data.order;
  if (storefront) {
    await prisma.order.update({ where: { id: order.id }, data: { order_type: "FOOD_MARKETPLACE" } });
  }
  return { ...order, phone };
}

export const accept = (api, rider, id) =>
  api("POST", `/orders/${id}/accept`, { token: rider.token, body: {} });

export const pickup = (api, w, rider, order, { payment_method = "COD", zone = w.zones[0] } = {}) =>
  api("PUT", `/orders/${order.id}/rider-pickup`, {
    token: rider.token,
    body: { customer_phone: order.phone, zone_id: zone.id, payment_method },
  });

export const deliver = (api, rider, id, key = uuid()) =>
  api("POST", `/orders/${id}/deliver`, {
    token: rider.token,
    headers: { "Idempotency-Key": key },
    body: { rider_lat: 11.0, rider_lng: 76.0 },
  });

/** place → accept → pickup, ready for delivery. */
export async function readyToDeliver(api, w, rider = w.riders[0], opts = {}) {
  const order = await placeOrder(api, w, opts);
  const a = await accept(api, rider, order.id);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const p = await pickup(api, w, rider, order, opts);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return { ...order, token: order.location_token };
}

/** Polls until `fn` returns something truthy (for fire-and-forget work such as push). */
export async function waitFor(fn, { timeout = 3000, every = 25 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, every));
  }
}
