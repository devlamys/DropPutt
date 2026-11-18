import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld } from "../helpers/fixtures.js";
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
