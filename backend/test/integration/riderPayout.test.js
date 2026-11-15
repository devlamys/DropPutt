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

const rider = () => w.riders[0];
const row = () => prisma.rider.findUnique({ where: { id: rider().rider.id } });
const deliverWith = async (payment_method) => {
  const o = await readyToDeliver(api, w, rider(), { payment_method });
  assert.equal((await deliver(api, rider(), o.id)).status, 200);
};
const pay = (body, { token = w.adminToken, key = uuid(), id = rider().rider.id } = {}) =>
  api("POST", `/admin/riders/${id}/payouts`, { token, headers: { "Idempotency-Key": key }, body });
const net = ({ token = w.adminToken, key = uuid(), id = rider().rider.id } = {}) =>
  api("POST", `/admin/riders/${id}/net-settlement`, { token, headers: { "Idempotency-Key": key }, body: {} });

describe("rider earnings payout (§15.2)", () => {
  it("pays part, then the rest, of what the franchise owes", async () => {
    await deliverWith("UPI_TO_ADMIN");
    await deliverWith("UPI_TO_ADMIN"); // wallet 60
    const part = await pay({ amount: "25", method: "UPI" });
    assert.equal(part.status, 201, JSON.stringify(part.body));
    assert.equal((await row()).wallet_earnings.toFixed(2), "35.00");
    assert.equal((await pay({ amount: "36" })).status, 422, "cannot pay more than owed");
    assert.equal((await pay({ amount: "35" })).status, 201);
    assert.equal((await row()).wallet_earnings.toFixed(2), "0.00");
  });

  it("the same Idempotency-Key pays once", async () => {
    await deliverWith("UPI_TO_ADMIN");
    const key = uuid();
    await pay({ amount: "10" }, { key });
    await pay({ amount: "10" }, { key });
    assert.equal(await prisma.riderPayout.count(), 1);
    assert.equal((await row()).wallet_earnings.toFixed(2), "20.00");
  });

  it("net settlement: rider owes more than earned → rider hands over the difference", async () => {
    await deliverWith("COD"); // cash 200 (food), wallet 0
    await deliverWith("UPI_TO_ADMIN"); // wallet 30
    const res = await net();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.cash_collected, "200.00");
    assert.equal(res.body.data.earnings_paid, "30.00");
    assert.equal(res.body.data.net, "170.00");
    assert.equal(res.body.data.direction, "RIDER_PAYS");
    const r = await row();
    assert.equal(r.cash_in_hand.toFixed(2), "0.00");
    assert.equal(r.wallet_earnings.toFixed(2), "0.00");
  });

  it("net settlement: franchise owes more → the franchise pays the difference", async () => {
    await deliverWith("UPI_TO_ADMIN");
    const res = await net();
    assert.equal(res.body.data.net, "-30.00");
    assert.equal(res.body.data.direction, "FRANCHISE_PAYS");
    assert.equal((await net()).status, 409, "nothing left to settle");
  });

  it("reconciliation still balances after payouts and net settlement", async () => {
    await deliverWith("COD");
    await deliverWith("UPI_TO_ADMIN");
    await pay({ amount: "10" });
    await net();
    const rec = await api("GET", "/admin/reconciliation", { token: w.adminToken });
    assert.ok(rec.body.data.balances.riders.every((r) => r.matches), JSON.stringify(rec.body.data.balances.riders));
    assert.equal(rec.body.data.check.orders_with_issues, 0, JSON.stringify(rec.body.data.check));
  });

  it("only admins, only inside the franchise; the overview shows net_due", async () => {
    await deliverWith("UPI_TO_ADMIN");
    assert.equal((await pay({ amount: "1" }, { token: w.vendorToken })).status, 403);
    assert.equal((await pay({ amount: "1" }, { token: rider().token })).status, 403);
    const cross = await pay({ amount: "1" }, { id: other.riders[0].rider.id });
    assert.ok([403, 404].includes(cross.status), `status ${cross.status}`);
    const o = await api("GET", "/admin/overview", { token: w.adminToken });
    const me = o.body.data.riders.find((r) => r.id === rider().rider.id);
    assert.equal(me.net_due, "-30.00");
  });
});
