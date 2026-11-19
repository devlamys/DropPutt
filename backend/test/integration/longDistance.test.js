import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld, nextPhone, pinAt } from "../helpers/fixtures.js";
import { accept, deliver, pickup } from "../helpers/flow.js";
import { calculateDeliveryDiscount, calculateSplit } from "../../src/utils/orderMath.js";

let server, api, w, farZone;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  // A far band (8-12 km, fee 80) that needs a food order of at least 250, and a 14 km delivery area.
  farZone = await prisma.zone.create({ data: { franchise_id: w.franchise.id, zone_name: "Zone 4", max_km: 12, delivery_fee: 80, min_order_value: 250 } });
  await prisma.franchise.update({ where: { id: w.franchise.id }, data: { max_delivery_km: 14 } });
});

const settings = (body) => api("PATCH", "/admin/franchise/settings", { token: w.adminToken, body });
const checkout = (km, quantity, extra = {}) =>
  api("POST", "/marketplace/checkout", {
    body: {
      vendor_id: w.vendor.id,
      ...pinAt(km),
      customer_phone: nextPhone(),
      drop_address: "Far house",
      items: [{ product_id: w.products.biryani.id, quantity }], // biryani is 100 each
      ...extra,
    },
  });

describe("delivery discount maths", () => {
  it("is the amount once the threshold is reached, never more than the fee", () => {
    const rule = { threshold: 350, amount: 20 };
    assert.equal(calculateDeliveryDiscount({ item_total: 349.99, delivery_fee: 50, ...rule }).toFixed(2), "0.00");
    assert.equal(calculateDeliveryDiscount({ item_total: 350, delivery_fee: 50, ...rule }).toFixed(2), "20.00");
    assert.equal(calculateDeliveryDiscount({ item_total: 900, delivery_fee: 15, ...rule }).toFixed(2), "15.00");
  });
  it("is off when the threshold or the amount is 0", () => {
    assert.equal(calculateDeliveryDiscount({ item_total: 900, delivery_fee: 50, threshold: 0, amount: 20 }).toFixed(2), "0.00");
    assert.equal(calculateDeliveryDiscount({ item_total: 900, delivery_fee: 50, threshold: 350, amount: 0 }).toFixed(2), "0.00");
  });
  it("comes out of the franchise's profit; the rider keeps the whole fee", () => {
    const base = { zone: { delivery_fee: 50 }, rider_tip: 0, shop_markup_profit: 0, vendor_commission: 35, royalty_per_order: 3 };
    const full = calculateSplit(base);
    const off = calculateSplit({ ...base, discount_amount: 20 });
    assert.equal(off.rider_earning.toFixed(2), full.rider_earning.toFixed(2));
    assert.equal(full.franchise_profit.toFixed(2), "32.00");
    assert.equal(off.franchise_profit.toFixed(2), "12.00");
  });
});

describe("minimum order for a far distance", () => {
  it("a far order below the band's minimum is refused; at the minimum it is accepted", async () => {
    const low = await checkout(9, 2); // 200 < 250
    assert.equal(low.status, 422, JSON.stringify(low.body));
    assert.match(JSON.stringify(low.body.error.details), /at least ₹250/);
    const ok = await checkout(9, 3); // 300
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  it("a near order only needs the shop's own minimum", async () => {
    assert.equal((await checkout(1, 1)).status, 201); // 100, shop minimum 100
  });

  it("the franchise admin changes it per band, and it shows in the zone list and the delivery quote", async () => {
    const edit = await api("PATCH", `/admin/zones/${farZone.id}`, { token: w.adminToken, body: { min_order_value: "400" } });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal(edit.body.data.zone.min_order_value, "400.00");
    assert.equal((await checkout(9, 3)).status, 422); // 300 < 400
    assert.equal((await checkout(9, 4)).status, 201);
    const quote = await api("POST", "/marketplace/delivery-quote", { body: { vendor_id: w.vendor.id, ...{ lat: pinAt(9).drop_lat, lng: pinAt(9).drop_lng } } });
    assert.equal(quote.body.data.min_order_value, "400.00");
    assert.equal(quote.body.data.delivery_fee, "80.00");
    const list = await api("GET", "/marketplace/zones", {});
    assert.equal(list.body.data.zones.find((z) => z.id === farZone.id).min_order_value, "400.00");
  });

  it("only a franchise admin may change it; a negative or silly value is refused", async () => {
    assert.equal((await api("PATCH", `/admin/zones/${farZone.id}`, { token: w.vendorToken, body: { min_order_value: "10" } })).status, 403);
    assert.equal((await api("PATCH", `/admin/zones/${farZone.id}`, { token: w.adminToken, body: { min_order_value: "-5" } })).status, 422);
  });

  it("the delivery area is as wide as the admin sets: 14 km accepted, 15 km refused", async () => {
    assert.equal((await checkout(13, 3)).status, 201);
    const far = await checkout(15, 3);
    assert.equal(far.status, 422);
    assert.equal(far.body.error.code, "OUTSIDE_DELIVERY_AREA");
  });
});

describe("delivery discount at checkout", () => {
  it("is set by the admin; the quote and the feed announce the rule", async () => {
    assert.equal((await settings({ delivery_discount_min: "300", delivery_discount_amount: "20" })).status, 200);
    const feed = await api("GET", "/marketplace/feed", {});
    assert.deepEqual(feed.body.data.delivery_discount, { min: "300.00", amount: "20.00" });
    const quote = await api("POST", "/marketplace/delivery-quote", { body: { vendor_id: w.vendor.id, lat: pinAt(1).drop_lat, lng: pinAt(1).drop_lng } });
    assert.deepEqual(quote.body.data.delivery_discount, { min: "300.00", amount: "20.00" });
  });

  it("an order at the threshold gets the discount; one below does not; there is none by default", async () => {
    const none = await checkout(1, 3); // no rule yet
    assert.equal(none.body.data.delivery_discount, "0.00");
    await settings({ delivery_discount_min: "300", delivery_discount_amount: "20" });
    const below = await checkout(1, 2); // 200 + 30 fee
    assert.equal(below.body.data.delivery_discount, "0.00");
    assert.equal(below.body.data.estimated_total, "230.00");
    const at = await checkout(1, 3); // 300 + 30 - 20
    assert.equal(at.status, 201, JSON.stringify(at.body));
    assert.equal(at.body.data.delivery_discount, "20.00");
    assert.equal(at.body.data.estimated_total, "310.00");
    const row = await prisma.order.findFirst({ where: { order_number: at.body.data.order_number } });
    assert.equal(row.discount_amount.toFixed(2), "20.00");
  });

  it("is never more than the delivery fee", async () => {
    await settings({ delivery_discount_min: "100", delivery_discount_amount: "100" });
    const res = await checkout(1, 1); // fee 30
    assert.equal(res.body.data.delivery_discount, "30.00");
    assert.equal(res.body.data.estimated_total, "100.00");
  });

  it("the rule is both or neither, and only for admins", async () => {
    assert.equal((await settings({ delivery_discount_min: "300" })).status, 422); // amount still 0
    assert.equal((await settings({ delivery_discount_min: "300", delivery_discount_amount: "20" })).status, 200);
    assert.equal((await settings({ delivery_discount_amount: "0" })).status, 422); // min still 300
    assert.equal((await settings({ delivery_discount_min: "0", delivery_discount_amount: "0" })).status, 200);
    assert.equal((await api("PATCH", "/admin/franchise/settings", { token: w.vendorToken, body: { delivery_discount_min: "1", delivery_discount_amount: "1" } })).status, 403);
  });

  it("settles: the customer pays less, the rider and the shop get their full share, the books balance", async () => {
    await settings({ delivery_discount_min: "300", delivery_discount_amount: "20" });
    const res = await checkout(1, 3); // 300 + 30 - 20 = 310
    const order = await prisma.order.findFirst({ where: { order_number: res.body.data.order_number } });
    const rider = w.riders[0];
    assert.equal((await accept(api, rider, order.id)).status, 200);
    const picked = await pickup(api, w, rider, { id: order.id, phone: order.customer_phone });
    assert.equal(picked.status, 200, JSON.stringify(picked.body));
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.grand_total.toFixed(2), "310.00");
    assert.equal(row.amount_to_collect.toFixed(2), "310.00"); // cash on delivery
    assert.equal(row.rider_earning.toFixed(2), "30.00"); // the whole fee, discount or not
    assert.equal(row.vendor_commission.toFixed(2), "30.00"); // 10% of 300
    assert.equal(row.franchise_profit.toFixed(2), "7.00"); // 30 commission - 3 royalty - 20 discount
    assert.equal((await deliver(api, rider, order.id)).status, 200);
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const report = await api("GET", `/admin/reconciliation?from=${today}&to=${today}`, { token: w.adminToken });
    assert.equal(report.status, 200);
    assert.equal(report.body.data.totals.orders, 1);
    assert.equal(report.body.data.check.orders_with_issues, 0, JSON.stringify(report.body.data.check));
    assert.deepEqual(report.body.data.check.discrepancies, []);
    assert.equal(report.body.data.totals.franchise_profit, "7.00");
    assert.equal(report.body.data.totals.grand_total, "310.00");
  });
});
