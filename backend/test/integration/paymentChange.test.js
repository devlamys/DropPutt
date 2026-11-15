import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld } from "../helpers/fixtures.js";
import { accept, deliver, placeOrder, readyToDeliver } from "../helpers/flow.js";

let server, raw, api, w, other;
before(async () => {
  server = await startServer();
  raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  other = await makeOtherWorld();
});

const rider = () => w.riders[0];
const change = (id, payment_method, token = rider().token) =>
  api("PATCH", `/orders/${id}/payment-method`, { token, body: { payment_method } });
const orderRow = (id) => prisma.order.findUnique({ where: { id } });
const SPLIT = ["grand_total", "vendor_commission", "vendor_earning", "rider_earning", "franchise_profit", "super_admin_profit"];

describe("correcting the payment method before delivery (§19.1)", () => {
  it("COD → paid at hotel incl. delivery: amounts re-priced, split untouched", async () => {
    const order = await readyToDeliver(api, w, rider(), { payment_method: "COD" });
    const before = await orderRow(order.id);
    assert.equal(before.amount_to_collect.toFixed(2), "230.00");
    const res = await change(order.id, "PREPAID_FULL_AT_HOTEL");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.changed, true);
    assert.equal(res.body.data.order.amount_to_collect, "0.00");
    assert.equal(res.body.data.order.collect_from_hotel, "30.00");
    const after = await orderRow(order.id);
    assert.equal(after.payment_method, "PREPAID_FULL_AT_HOTEL");
    for (const key of SPLIT) assert.equal(after[key].toFixed(2), before[key].toFixed(2), key);
    // COD pays the hotel its earning; prepaid leaves only the commission owed
    assert.notEqual(after.vendor_admin_payable.toFixed(2), before.vendor_admin_payable.toFixed(2));
  });

  it("delivery after the correction settles by the new method; reconciliation is clean", async () => {
    const order = await readyToDeliver(api, w, rider(), { payment_method: "COD" });
    await change(order.id, "PREPAID_AT_HOTEL");
    const res = await deliver(api, rider(), order.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = await prisma.rider.findUnique({ where: { id: rider().rider.id } });
    assert.equal(r.cash_in_hand.toFixed(2), "0.00"); // fee collected and kept, nothing owed
    assert.equal(r.wallet_earnings.toFixed(2), "0.00");
    const rec = await api("GET", "/admin/reconciliation", { token: w.adminToken });
    assert.equal(rec.body.data.check.orders_with_issues, 0, JSON.stringify(rec.body.data.check));
    assert.ok(rec.body.data.balances.vendors.every((v) => v.matches));
  });

  it("a rain surge or customer tip is not added twice", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { rain_surge_fee: 20 } });
    const order = await readyToDeliver(api, w, rider(), { payment_method: "COD" });
    const before = await orderRow(order.id);
    assert.equal(before.rider_tip.toFixed(2), "20.00");
    await change(order.id, "UPI_TO_ADMIN");
    await change(order.id, "COD");
    const after = await orderRow(order.id);
    assert.equal(after.rider_tip.toFixed(2), "20.00");
    assert.equal(after.amount_to_collect.toFixed(2), before.amount_to_collect.toFixed(2));
    assert.equal(await prisma.settlementEntry.count({ where: { order_id: order.id, type: "RAIN_SURGE" } }), 1);
  });

  it("the same method is a no-op", async () => {
    const order = await readyToDeliver(api, w, rider(), { payment_method: "COD" });
    const res = await change(order.id, "COD");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.changed, false);
  });

  it("only the assigned rider, only between pickup and delivery", async () => {
    const order = await readyToDeliver(api, w, rider(), { payment_method: "COD" });
    assert.equal((await change(order.id, "UPI_TO_ADMIN", w.riders[1].token)).status, 403);
    assert.equal((await change(order.id, "UPI_TO_ADMIN", w.vendorToken)).status, 403);
    assert.equal((await change(order.id, "UPI_TO_ADMIN", w.adminToken)).status, 403);

    const fresh = await placeOrder(api, w);
    await accept(api, rider(), fresh.id);
    const early = await change(fresh.id, "UPI_TO_ADMIN");
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, "NOT_PICKED_UP");

    await deliver(api, rider(), order.id);
    const late = await change(order.id, "UPI_TO_ADMIN");
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, "ORDER_ALREADY_DELIVERED");
  });

  it("prepaid methods need a partner vendor; other franchises cannot reach the order", async () => {
    const res = await api("POST", "/orders/quick-call", {
      token: w.adminToken,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { order_type: "PICK_DROP" },
    });
    const id = res.body.data.order.id;
    await accept(api, rider(), id);
    const picked = await api("PUT", `/orders/${id}/rider-pickup`, {
      token: rider().token,
      body: { customer_phone: "9876543210", zone_id: w.zones[0].id, payment_method: "COD" },
    });
    assert.equal(picked.status, 200, JSON.stringify(picked.body));
    assert.equal((await change(id, "PREPAID_FULL_AT_HOTEL")).status, 422);
    assert.equal((await change(id, "PREPAID_AT_HOTEL")).status, 422);
    assert.equal((await change(id, "UPI_TO_ADMIN")).status, 200);
    const cross = await raw("PATCH", `/orders/${id}/payment-method`, { token: other.riders[0].token, slug: "other", body: { payment_method: "COD" } });
    assert.ok([403, 404].includes(cross.status), `status ${cross.status}`);
  });
});
