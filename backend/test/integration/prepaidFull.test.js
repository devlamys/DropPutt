import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld } from "../helpers/fixtures.js";
import { accept, deliver, pickup, placeOrder, readyToDeliver } from "../helpers/flow.js";

let server, raw, api, w;
before(async () => {
  server = await startServer();
  raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});

const METHOD = "PREPAID_FULL_AT_HOTEL";
const rider = () => w.riders[0];
const riderRow = () => prisma.rider.findUnique({ where: { id: rider().rider.id } });
const vendorBalance = async () => Number((await prisma.vendor.findUnique({ where: { id: w.vendor.id } })).admin_payable_balance);

describe("paid at hotel incl. delivery (§14.4)", () => {
  it("the rider takes the fee from the hotel and collects nothing at the door", async () => {
    const order = await placeOrder(api, w, { storefront: false });
    await accept(api, rider(), order.id);
    const res = await pickup(api, w, rider(), order, { payment_method: METHOD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const o = res.body.data.order;
    assert.equal(o.amount_to_collect, "0.00");
    assert.equal(o.collect_from_hotel, "30.00");
    assert.equal(o.pay_vendor, "0.00");
  });

  it("delivery: nothing owed either way during the trial; ledger and reconciliation balance", async () => {
    const order = await readyToDeliver(api, w, rider(), { storefront: false, payment_method: METHOD });
    const res = await deliver(api, rider(), order.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.settlement.cash_collected, "30.00");
    assert.equal(res.body.data.settlement.earning_kept, "30.00");
    const r = await riderRow();
    assert.equal(r.cash_in_hand.toFixed(2), "0.00");
    assert.equal(r.wallet_earnings.toFixed(2), "0.00");
    assert.equal(await vendorBalance(), 0); // commission-free trial
    const owed = await api("GET", "/rider/me/cash-owed", { token: rider().token });
    assert.equal(owed.body.data.vendors.length, 0, "not money the rider owes the hotel");
    const rec = await api("GET", "/admin/reconciliation", { token: w.adminToken });
    assert.equal(rec.body.data.check.orders_with_issues, 0, JSON.stringify(rec.body.data.check));
    assert.ok(rec.body.data.balances.riders.every((x) => x.matches));
    assert.ok(rec.body.data.balances.vendors.every((x) => x.matches));
  });

  it("after the trial the hotel owes only the commission", async () => {
    await prisma.vendor.update({ where: { id: w.vendor.id }, data: { commission_free_until: new Date(Date.now() - 1000) } });
    const order = await readyToDeliver(api, w, rider(), { storefront: false, payment_method: METHOD });
    await deliver(api, rider(), order.id);
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(await vendorBalance(), -Number(row.vendor_commission));
    assert.equal((await riderRow()).wallet_earnings.toFixed(2), "0.00");
  });

  it("needs a partner vendor", async () => {
    const res = await api("POST", "/orders/quick-call", {
      token: w.adminToken,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { order_type: "PICK_DROP" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = { ...res.body.data.order, phone: "9876543210" };
    await accept(api, rider(), order.id);
    const p = await pickup(api, w, rider(), order, { payment_method: METHOD });
    assert.equal(p.status, 422);
  });
});
