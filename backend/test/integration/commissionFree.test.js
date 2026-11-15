import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld } from "../helpers/fixtures.js";
import { deliver, readyToDeliver } from "../helpers/flow.js";

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

describe("Call Rider Now trial: no commission, royalty still charged (§10.1)", () => {
  it("during the trial a vendor call has no commission but the royalty still goes to the Super Admin; the rider keeps the fee", async () => {
    const order = await readyToDeliver(api, w, w.riders[0], { storefront: false, payment_method: "COD" });
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).order_type, "HOTEL_DIRECT");
    assert.equal((await deliver(api, w.riders[0], order.id)).status, 200);

    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.vendor_commission.toFixed(2), "0.00");
    assert.equal(row.commission_rate.toFixed(2), "0.00");
    assert.equal(row.vendor_earning.toFixed(2), row.item_total.toFixed(2));
    assert.equal(row.super_admin_profit.toFixed(2), "3.00"); // royalty as before
    assert.equal(row.rider_earning.toFixed(2), "30.00");
    assert.equal(row.franchise_profit.toFixed(2), "-3.00"); // only the royalty, kept negative

    const franchise = await prisma.franchise.findUnique({ where: { id: w.franchise.id } });
    assert.equal(franchise.wallet_balance.toFixed(2), "-3.00");
    assert.equal(await prisma.walletTransaction.count({ where: { order_id: order.id, type: "DEBIT" } }), 1);
    assert.equal(await prisma.settlementEntry.count({ where: { order_id: order.id, type: "ROYALTY" } }), 1);
    const vendor = await prisma.vendor.findUnique({ where: { id: w.vendor.id } });
    assert.equal(vendor.admin_payable_balance.toFixed(2), row.item_total.toFixed(2));
  });

  it("a commission-free delivery reconciles cleanly next to a storefront one", async () => {
    const call = await readyToDeliver(api, w, w.riders[0], { storefront: false });
    const store = await readyToDeliver(api, w, w.riders[1], { storefront: true });
    await deliver(api, w.riders[0], call.id);
    await deliver(api, w.riders[1], store.id);
    const res = await api("GET", "/admin/reconciliation", { token: w.adminToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.check.orders_with_issues, 0, JSON.stringify(res.body.data.check));
    assert.equal(res.body.data.totals.super_admin_royalty, "6.00"); // both orders pay royalty
  });

  it("after the hotel's trial ends a Call Rider Now order pays 1% commission and the royalty", async () => {
    await prisma.vendor.update({
      where: { id: w.vendor.id },
      data: { commission_rate: 1, commission_free_until: new Date(Date.now() - 1000) },
    });
    const order = await readyToDeliver(api, w, w.riders[0], { storefront: false, payment_method: "PREPAID_AT_HOTEL" });
    assert.equal((await deliver(api, w.riders[0], order.id)).status, 200);
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.order_type, "HOTEL_DIRECT");
    assert.equal(row.commission_rate.toFixed(2), "1.00");
    assert.equal(row.vendor_commission.toFixed(2), (Number(row.item_total) * 0.01).toFixed(2));
    assert.equal(row.super_admin_profit.toFixed(2), "3.00");
    assert.equal(row.rider_earning.toFixed(2), "30.00");
    const vendor = await prisma.vendor.findUnique({ where: { id: w.vendor.id } });
    assert.equal(Number(vendor.admin_payable_balance), -Number(row.vendor_commission)); // the hotel owes it
    assert.equal((await prisma.franchise.findUnique({ where: { id: w.franchise.id } })).wallet_balance.toFixed(2), "-3.00");
  });

  it("ending the trial later only affects orders picked up afterwards", async () => {
    const early = await readyToDeliver(api, w, w.riders[0], { storefront: false });
    await prisma.vendor.update({ where: { id: w.vendor.id }, data: { commission_rate: 1, commission_free_until: new Date(Date.now() - 1000) } });
    const late = await readyToDeliver(api, w, w.riders[1], { storefront: false });
    assert.equal((await prisma.order.findUnique({ where: { id: early.id } })).vendor_commission.toFixed(2), "0.00");
    assert.ok(Number((await prisma.order.findUnique({ where: { id: late.id } })).vendor_commission) > 0);
  });

  it("a storefront order pays commission even inside the trial", async () => {
    const order = await readyToDeliver(api, w, w.riders[0], { storefront: true });
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.commission_rate.toFixed(2), "10.00");
    assert.ok(Number(row.vendor_commission) > 0);
  });
});
