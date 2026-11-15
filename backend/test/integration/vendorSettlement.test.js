import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld } from "../helpers/fixtures.js";
import { deliver, readyToDeliver, uuid } from "../helpers/flow.js";

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

const balance = async () => Number((await prisma.vendor.findUnique({ where: { id: w.vendor.id } })).admin_payable_balance);
const settle = (body, { token = w.adminToken, key = uuid(), id = w.vendor.id, slug = "tf" } = {}) =>
  raw("POST", `/admin/vendors/${id}/settlements`, { token, slug, headers: { "Idempotency-Key": key }, body });

/**
 * A storefront COD order: the rider hands the hotel the food money, so the
 * hotel's balance goes from +earning (180) to -commission (20).
 */
async function hotelOwesCommission() {
  const order = await readyToDeliver(api, w, w.riders[0], { storefront: true, payment_method: "COD" });
  assert.equal((await deliver(api, w.riders[0], order.id)).status, 200);
  const owed = (await api("GET", "/rider/me/cash-owed", { token: w.riders[0].token })).body.data.vendors[0].owed;
  const created = await api("POST", "/rider/me/cash-handover", {
    token: w.riders[0].token,
    headers: { "Idempotency-Key": uuid() },
    body: { vendor_id: w.vendor.id, amount: owed },
  });
  await raw("POST", `/vendor/cash-handovers/${created.body.data.handover.id}/confirm`, {
    token: w.vendorToken,
    slug: "tf",
    body: {},
  });
  assert.equal(await balance(), -20);
}

describe("vendor commission settlement (§16.1)", () => {
  it("lists the hotel with what it owes and the commission accrued", async () => {
    await hotelOwesCommission();
    const res = await api("GET", "/admin/vendors", { token: w.adminToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const v = res.body.data.vendors[0];
    assert.equal(v.admin_payable_balance, "-20.00");
    assert.equal(v.owes, "VENDOR");
    assert.equal(v.commission.today, "20.00");
  });

  it("a hotel with a zero balance is shown as settled, not as owed", async () => {
    const res = await api("GET", "/admin/vendors", { token: w.adminToken });
    assert.equal(res.body.data.vendors[0].admin_payable_balance, "0.00");
    assert.equal(res.body.data.vendors[0].owes, "NONE");
  });

  it("statement shows the orders, commission and totals for the range", async () => {
    await hotelOwesCommission();
    const res = await api("GET", "/admin/vendors/" + w.vendor.id + "/statement", { token: w.adminToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.totals.orders, 1);
    assert.equal(res.body.data.totals.commission, "20.00");
    assert.equal(res.body.data.orders[0].commission_free, false);
  });

  it("recording the hotel's payment clears the balance; partial payments work", async () => {
    await hotelOwesCommission();
    const part = await settle({ direction: "VENDOR_PAID_FRANCHISE", amount: "5", method: "UPI" });
    assert.equal(part.status, 201, JSON.stringify(part.body));
    assert.equal(await balance(), -15);
    const rest = await settle({ direction: "VENDOR_PAID_FRANCHISE", amount: "15" });
    assert.equal(rest.status, 201);
    assert.equal(await balance(), 0);
    assert.equal(await prisma.vendorSettlement.count(), 2);
  });

  it("cannot overpay or pay the wrong way", async () => {
    await hotelOwesCommission();
    assert.equal((await settle({ direction: "VENDOR_PAID_FRANCHISE", amount: "21" })).status, 422);
    assert.equal((await settle({ direction: "FRANCHISE_PAID_VENDOR", amount: "1" })).status, 422);
    assert.equal(await balance(), -20);
  });

  it("the franchise paying the hotel lowers a positive balance", async () => {
    const order = await readyToDeliver(api, w, w.riders[0], { storefront: true });
    await deliver(api, w.riders[0], order.id);
    assert.equal(await balance(), 180);
    assert.equal((await settle({ direction: "FRANCHISE_PAID_VENDOR", amount: "180" })).status, 201);
    assert.equal(await balance(), 0);
  });

  it("the same Idempotency-Key records the payment once", async () => {
    await hotelOwesCommission();
    const key = uuid();
    await settle({ direction: "VENDOR_PAID_FRANCHISE", amount: "10" }, { key });
    await settle({ direction: "VENDOR_PAID_FRANCHISE", amount: "10" }, { key });
    assert.equal(await balance(), -10);
    assert.equal(await prisma.vendorSettlement.count(), 1);
  });

  it("only the franchise admin, and only inside the franchise", async () => {
    await hotelOwesCommission();
    const body = { direction: "VENDOR_PAID_FRANCHISE", amount: "1" };
    assert.equal((await settle(body, { token: w.vendorToken })).status, 403);
    assert.equal((await settle(body, { token: w.riders[0].token })).status, 403);
    const cross = await settle(body, { id: other.vendor.id });
    assert.ok([403, 404].includes(cross.status), `status ${cross.status}`);
    assert.equal(Number((await prisma.vendor.findUnique({ where: { id: other.vendor.id } })).admin_payable_balance), 0);
  });

  it("the vendor sees its settlements and reconciliation still balances", async () => {
    await hotelOwesCommission();
    await settle({ direction: "VENDOR_PAID_FRANCHISE", amount: "20" });
    const ledger = await raw("GET", "/vendor/ledger", { token: w.vendorToken, slug: "tf" });
    assert.equal(ledger.status, 200, JSON.stringify(ledger.body));
    assert.equal(ledger.body.data.settlements.length, 1);
    assert.equal(ledger.body.data.items[0].commission, "20.00");
    const rec = await api("GET", "/admin/reconciliation", { token: w.adminToken });
    assert.ok(rec.body.data.balances.vendors.every((v) => v.matches), JSON.stringify(rec.body.data.balances.vendors));
  });
});
