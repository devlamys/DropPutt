import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld } from "../helpers/fixtures.js";
import { accept, pickup, placeOrder } from "../helpers/flow.js";

let server, api, w;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});

const page = (order) => api("GET", `/public/drop/${order.location_token}`);
const received = (order) => api("POST", `/public/drop/${order.location_token}/received`, { body: {} });

describe("customer 'I received it' (optional proof)", () => {
  it("is not offered before the rider has picked up, and is refused", async () => {
    const order = await placeOrder(api, w);
    assert.equal((await page(order)).body.data.can_confirm_received, false);
    const res = await received(order);
    assert.equal(res.status, 409);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).customer_received_at, null);
  });

  it("after pickup it can be confirmed once; repeating changes nothing", async () => {
    const order = await placeOrder(api, w);
    const rider = w.riders[0];
    assert.equal((await accept(api, rider, order.id)).status, 200);
    assert.equal((await pickup(api, w, rider, order)).status, 200);
    assert.equal((await page(order)).body.data.can_confirm_received, true);

    const first = await received(order);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.already, false);
    const second = await received(order);
    assert.equal(second.body.data.already, true);
    assert.equal(second.body.data.received_at, first.body.data.received_at);

    const view = (await page(order)).body.data;
    assert.equal(view.can_confirm_received, false);
    assert.ok(view.received_at);
    // The tap never moves the order along or touches money.
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).order_status, "PICKED_UP");
  });

  it("an unknown link is not found", async () => {
    const res = await api("POST", `/public/drop/${"x".repeat(32)}/received`, { body: {} });
    assert.equal(res.status, 404);
  });
});

describe("shop's 'ready in N minutes'", () => {
  const setPrep = (order, minutes, token = w.vendorToken) => api("POST", `/orders/${order.id}/prep-time`, { token, body: { minutes } });

  it("the shop sets it, the customer's page shows the time, and the shop can change it", async () => {
    const order = await placeOrder(api, w);
    assert.equal((await page(order)).body.data.prep_ready_at, null);
    const before = Date.now();
    const res = await setPrep(order, 15);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const readyAt = new Date(res.body.data.prep_ready_at).getTime();
    assert.ok(Math.abs(readyAt - (before + 15 * 60_000)) < 5000);
    assert.equal((await page(order)).body.data.prep_ready_at, res.body.data.prep_ready_at);
    const again = await setPrep(order, 30);
    assert.ok(new Date(again.body.data.prep_ready_at).getTime() > readyAt);
  });

  it("only the listed times are accepted, and only the shop of the order may set it", async () => {
    const order = await placeOrder(api, w);
    assert.equal((await setPrep(order, 7)).status, 422);
    assert.equal((await setPrep(order, 15, w.riders[0].token)).status, 403);
    const other = await makeOtherWorld();
    const res = await api("POST", `/orders/${order.id}/prep-time`, { token: other.vendorToken, slug: "other", body: { minutes: 10 } });
    assert.equal(res.status, 404);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).prep_ready_at, null);
  });

  it("is refused once the rider has collected the order, and the page stops showing it", async () => {
    const order = await placeOrder(api, w);
    const rider = w.riders[0];
    await accept(api, rider, order.id);
    assert.equal((await setPrep(order, 10)).status, 200);
    assert.equal((await pickup(api, w, rider, order)).status, 200);
    assert.equal((await setPrep(order, 10)).status, 409);
    assert.equal((await page(order)).body.data.prep_ready_at, null);
  });
});
