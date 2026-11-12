import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld } from "../helpers/fixtures.js";
import { deliver, readyToDeliver } from "../helpers/flow.js";

let server, api, w, today;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
});

const report = (qs = "") => api("GET", `/admin/reconciliation?from=${today}&to=${today}${qs}`, { token: w.adminToken });
async function deliverTwo() {
  const a = await readyToDeliver(api, w, w.riders[0], { payment_method: "COD" });
  const b = await readyToDeliver(api, w, w.riders[1], { payment_method: "PREPAID_AT_HOTEL" });
  await deliver(api, w.riders[0], a.id);
  await deliver(api, w.riders[1], b.id);
  return [a, b];
}

describe("reconciliation (§41)", () => {
  it("clean deliveries reconcile and the totals add up", async () => {
    await deliverTwo();
    const res = await report();
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.totals.orders, 2);
    assert.equal(d.totals.grand_total, "460.00");
    assert.equal(d.totals.vendor_earning, "360.00");
    assert.equal(d.totals.rider_earning, "40.00");
    assert.equal(d.totals.franchise_profit, "54.00");
    assert.equal(d.totals.super_admin_royalty, "6.00");
    // the four shares account for the whole order total
    const sum = [d.totals.vendor_earning, d.totals.rider_earning, d.totals.franchise_profit, d.totals.super_admin_royalty].reduce((n, v) => n + Number(v), 0);
    assert.equal(sum, Number(d.totals.grand_total));
    assert.equal(d.check.orders_with_issues, 0);
    assert.deepEqual(d.check.discrepancies, []);
    assert.equal(d.totals.cash_collected_by_riders, "260.00"); // 230 COD + 30 prepaid
    const methods = Object.fromEntries(d.by_payment_method.map((m) => [m.payment_method, m]));
    assert.equal(methods.COD.amount_to_collect, "230.00");
    assert.equal(methods.PREPAID_AT_HOTEL.amount_to_collect, "30.00");
  });

  it("stored balances match their ledgers after normal activity", async () => {
    await deliverTwo();
    const { balances } = (await report()).body.data;
    assert.equal(balances.franchise_wallet.matches, true);
    assert.ok(balances.riders.every((r) => r.matches));
    assert.ok(balances.vendors.every((v) => v.matches));
    assert.equal(balances.franchise_wallet.stored, "-6.00");
  });

  it("a wrong split is caught (and the ledger disagreement with it)", async () => {
    const [a] = await deliverTwo();
    await prisma.order.update({ where: { id: a.id }, data: { franchise_profit: { increment: "5" } } });
    const d = (await report()).body.data;
    assert.equal(d.check.orders_with_issues, 1);
    const codes = d.check.discrepancies[0].issues.map((i) => i.code);
    assert.ok(codes.includes("SPLIT_MISMATCH"));
    assert.ok(codes.includes("AMOUNT_MISMATCH"));
  });

  it("a missing royalty debit is caught, and the wallet no longer matches", async () => {
    const [, b] = await deliverTwo();
    await prisma.walletTransaction.deleteMany({ where: { order_id: b.id } });
    const d = (await report()).body.data;
    assert.ok(d.check.discrepancies[0].issues.some((i) => i.code === "MISSING_ENTRY"));
    assert.equal(d.balances.franchise_wallet.matches, false);
  });

  it("a missing settlement entry is caught", async () => {
    const [a] = await deliverTwo();
    await prisma.settlementEntry.deleteMany({ where: { reference_key: `order:${a.id}:vendor-payable` } });
    const d = (await report()).body.data;
    assert.ok(d.check.discrepancies[0].issues.some((i) => i.message.includes("Vendor payable")));
    assert.equal(d.balances.vendors[0].matches, false);
  });

  it("a tampered rider balance is caught", async () => {
    await deliverTwo();
    await prisma.rider.update({ where: { id: w.riders[0].rider.id }, data: { wallet_earnings: { increment: "100" } } });
    const { balances } = (await report()).body.data;
    assert.equal(balances.riders.find((r) => r.id === w.riders[0].rider.id).matches, false);
  });

  it("the order list is paginated and flags bad rows", async () => {
    const [a] = await deliverTwo();
    await prisma.order.update({ where: { id: a.id }, data: { rider_earning: { increment: "1" } } });
    const page1 = await api("GET", `/admin/reconciliation/orders?from=${today}&to=${today}&limit=1`, { token: w.adminToken });
    assert.equal(page1.body.data.orders.length, 1);
    assert.equal(page1.body.meta.pagination.has_more, true);
    const page2 = await api("GET", `/admin/reconciliation/orders?from=${today}&to=${today}&limit=1&cursor=${encodeURIComponent(page1.body.meta.pagination.next_cursor)}`, { token: w.adminToken });
    const rows = [...page1.body.data.orders, ...page2.body.data.orders];
    assert.equal(rows.find((r) => r.id === a.id).reconciled, false);
    assert.equal(rows.find((r) => r.id !== a.id).reconciled, true);
  });

  it("only admins may read it, and the range is validated", async () => {
    assert.equal((await api("GET", "/admin/reconciliation", { token: w.vendorToken })).status, 403);
    assert.equal((await api("GET", "/admin/reconciliation", { token: w.riders[0].token })).status, 403);
    assert.equal((await api("GET", "/admin/reconciliation", {})).status, 401);
    for (const qs of ["?from=abc", "?from=2026-02-30", "?from=2026-11-10&to=2026-11-01", "?from=2026-01-01&to=2026-11-01"]) {
      assert.equal((await api("GET", `/admin/reconciliation${qs}`, { token: w.adminToken })).status, 422, qs);
    }
  });

  it("an empty period is fine", async () => {
    const d = (await report()).body.data;
    assert.equal(d.totals.orders, 0);
    assert.equal(d.check.orders_with_issues, 0);
  });
});

describe("earnings and vendor ledger", () => {
  it("rider earnings equal the wallet; vendor ledger equals the payable balance", async () => {
    await deliverTwo();
    const e = await api("GET", "/rider/earnings", { token: w.riders[0].token });
    assert.equal(e.body.data.today.deliveries, 1);
    assert.equal(e.body.data.wallet_earnings, e.body.data.today.earning);
    const v = await api("GET", "/vendor/ledger", { token: w.vendorToken });
    const total = v.body.data.items.reduce((n, r) => n + Number(r.amount), 0);
    assert.equal(total, Number(v.body.data.admin_payable_balance));
    assert.equal(v.body.data.items.length, 2);
  });
});
