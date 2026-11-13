import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld } from "../helpers/fixtures.js";
import { accept, deliver, pickup, placeOrder, readyToDeliver, uuid } from "../helpers/flow.js";
import { sweepStaleOrders } from "../../src/services/staleOrderService.js";

let server, rawApi, api, w;
const slugged = (slug) => (m, p, o) => rawApi(m, p, { slug, ...o });

before(async () => {
  server = await startServer();
  rawApi = client(server.url);
  api = slugged("tf");
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});

const orderRow = (id) => prisma.order.findUnique({ where: { id } });
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const age = (id, minutes) =>
  prisma.order.update({ where: { id }, data: { created_at: minutesAgo(minutes) } });

const adminCancel = (id, body = {}, token = w.adminToken) =>
  api("POST", `/orders/${id}/cancel`, { token, body });
const vendorCancel = (id, body = {}) => adminCancel(id, body, w.vendorToken);
const customerCancel = (order) => api("POST", `/public/drop/${order.location_token}/cancel`, { body: {} });

async function assertNoMoneyMoved(orderId) {
  const [entries, franchise, riders] = await Promise.all([
    prisma.settlementEntry.findMany({ where: { order_id: orderId, type: { not: "RIDER_TIP" } } }),
    prisma.franchise.findUnique({ where: { id: w.franchise.id } }),
    prisma.rider.findMany({ where: { franchise_id: w.franchise.id } }),
  ]);
  assert.equal(entries.length, 0, "a cancelled order writes no settlement entries");
  assert.equal(franchise.wallet_balance.toString(), "0", "no royalty is charged");
  for (const r of riders) {
    assert.equal(r.cash_in_hand.toString(), "0");
    assert.equal(r.wallet_earnings.toString(), "0");
  }
  const vendor = await prisma.vendor.findUnique({ where: { id: w.vendor.id } });
  assert.equal(vendor.admin_payable_balance.toString(), "0");
  assert.equal(await prisma.walletTransaction.count(), 0);
}

describe("cancelling an order", () => {
  it("the franchise admin cancels an open request and nothing is charged", async () => {
    const order = await placeOrder(api, w);
    const res = await adminCancel(order.id, { reason: "Shop is out of stock" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order.order_status, "CANCELLED");
    assert.equal(res.body.data.already, false);

    const row = await orderRow(order.id);
    assert.equal(row.order_status, "CANCELLED");
    assert.equal(row.cancelled_by_role, "FRANCHISE_ADMIN");
    assert.equal(row.cancel_reason, "Shop is out of stock");
    assert.ok(row.cancelled_at);
    await assertNoMoneyMoved(order.id);
  });

  it("is idempotent: cancelling twice changes nothing the second time", async () => {
    const order = await placeOrder(api, w);
    await adminCancel(order.id, { reason: "first" });
    const first = await orderRow(order.id);

    const again = await adminCancel(order.id, { reason: "second" });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.already, true);
    const second = await orderRow(order.id);
    assert.equal(second.cancel_reason, "first");
    assert.equal(second.cancelled_at.getTime(), first.cancelled_at.getTime());
  });

  it("a cancelled order can no longer be accepted, tipped or shared", async () => {
    const order = await placeOrder(api, w);
    await adminCancel(order.id);

    const taken = await accept(api, w.riders[0], order.id);
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, "ORDER_ALREADY_ACCEPTED");

    const tip = await api("POST", `/public/drop/${order.location_token}/tip`, {
      body: { tip: 20, client_action_id: uuid() },
    });
    assert.equal(tip.status, 409);

    const pin = await api("POST", `/public/drop/${order.location_token}/voice-and-pin`, {
      body: { lat: 11.1, lng: 76.1, gps_accuracy: 10 },
    });
    assert.equal(pin.status, 409);

    const status = await api("GET", `/public/drop/${order.location_token}/status`);
    assert.equal(status.body.data.order_status, "CANCELLED");
  });

  it("the shop can cancel its own order until the rider picks it up", async () => {
    const waiting = await placeOrder(api, w);
    assert.equal((await vendorCancel(waiting.id)).status, 200);
    assert.equal((await orderRow(waiting.id)).cancelled_by_role, "VENDOR");

    const assigned = await placeOrder(api, w);
    assert.equal((await accept(api, w.riders[0], assigned.id)).status, 200);
    assert.equal((await vendorCancel(assigned.id)).status, 200);
    assert.equal((await orderRow(assigned.id)).order_status, "CANCELLED");

    const pickedUp = await readyToDeliver(api, w, w.riders[1]);
    const late = await vendorCancel(pickedUp.id);
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, "ORDER_NOT_CANCELLABLE");
    assert.equal((await orderRow(pickedUp.id)).order_status, "PICKED_UP");
  });

  it("the admin can cancel after pickup, and the rider can then no longer deliver", async () => {
    const order = await readyToDeliver(api, w);
    const res = await adminCancel(order.id, { reason: "Customer unreachable" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const delivered = await deliver(api, w.riders[0], order.id);
    assert.ok(delivered.status >= 400 && delivered.status < 500, `deliver returned ${delivered.status}`);
    assert.equal((await orderRow(order.id)).order_status, "CANCELLED");
    await assertNoMoneyMoved(order.id);
  });

  it("a delivered order cannot be cancelled", async () => {
    const order = await readyToDeliver(api, w);
    assert.equal((await deliver(api, w.riders[0], order.id)).status, 200);

    const res = await adminCancel(order.id);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "ORDER_NOT_CANCELLABLE");
    assert.equal((await orderRow(order.id)).order_status, "DELIVERED");
  });

  it("the customer can cancel only while no rider has accepted", async () => {
    const open = await placeOrder(api, w);
    const res = await customerCancel(open);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order_status, "CANCELLED");
    assert.equal((await orderRow(open.id)).cancelled_by_role, "CUSTOMER");
    assert.equal((await customerCancel(open)).body.data.already, true); // double tap

    const taken = await placeOrder(api, w);
    await accept(api, w.riders[0], taken.id);
    const late = await customerCancel(taken);
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, "ORDER_NOT_CANCELLABLE");
  });

  it("an unknown Magic Link token is a 404", async () => {
    const res = await api("POST", `/public/drop/${"x".repeat(32)}/cancel`, { body: {} });
    assert.equal(res.status, 404);
  });

  it("is tenant-scoped: another franchise's admin cannot cancel it", async () => {
    const other = await makeOtherWorld();
    const order = await placeOrder(api, w);

    const res = await rawApi("POST", `/orders/${order.id}/cancel`, {
      slug: "other",
      token: other.adminToken,
      body: {},
    });
    assert.equal(res.status, 404);
    assert.equal((await orderRow(order.id)).order_status, "RIDER_REQUESTED");
  });

  it("a shop cannot cancel another shop's order in the same franchise", async () => {
    const order = await placeOrder(api, w);
    const { tokenFor } = await import("../helpers/fixtures.js");
    const user = await prisma.user.create({
      data: { franchise_id: w.franchise.id, role: "VENDOR", name: "Bakery", phone: "9111111111", pin_hash: "x" },
    });
    await prisma.vendor.create({
      data: { franchise_id: w.franchise.id, user_id: user.id, shop_name: "Bakery", address: "x", lat: "11.0", lng: "76.0" },
    });
    const res = await adminCancel(order.id, {}, tokenFor(user));
    assert.equal(res.status, 404);
    assert.equal((await orderRow(order.id)).order_status, "RIDER_REQUESTED");
  });

  it("riders cannot use the cancel endpoint", async () => {
    const order = await placeOrder(api, w);
    const res = await adminCancel(order.id, {}, w.riders[0].token);
    assert.equal(res.status, 403);
  });

  it("a rider accepting and the customer cancelling at once: exactly one wins", async () => {
    // The customer may cancel only before acceptance, so the two actions are
    // mutually exclusive and the row lock must pick one winner.
    for (let i = 0; i < 6; i += 1) {
      const order = await placeOrder(api, w);
      const [acc, can] = await Promise.all([accept(api, w.riders[0], order.id), customerCancel(order)]);
      const row = await orderRow(order.id);

      assert.notEqual(acc.status === 200, can.status === 200, `round ${i}: both or neither won (${acc.status}/${can.status})`);
      if (acc.status === 200) {
        assert.equal(can.status, 409);
        assert.equal(row.order_status, "RIDER_ASSIGNED");
        assert.ok(row.rider_id);
      } else {
        assert.equal(acc.status, 409);
        assert.equal(row.order_status, "CANCELLED");
        assert.equal(row.rider_id, null);
      }
      // Free the rider's slot for the next round.
      await prisma.order.updateMany({ where: { rider_id: w.riders[0].rider.id }, data: { order_status: "CANCELLED" } });
    }
  });

  it("an admin cancelling right after accept still wins cleanly (rider is released)", async () => {
    const order = await placeOrder(api, w);
    assert.equal((await accept(api, w.riders[0], order.id)).status, 200);
    assert.equal((await adminCancel(order.id)).status, 200);
    const row = await orderRow(order.id);
    assert.equal(row.order_status, "CANCELLED");
    // The rider has no active order left, so they can take another one.
    const next = await placeOrder(api, w);
    assert.equal((await accept(api, w.riders[0], next.id)).status, 200);
  });
});

describe("stale-order sweep", () => {
  it("re-dispatches an order nobody took, once per interval", async () => {
    const order = await placeOrder(api, w);
    await age(order.id, 12);

    const first = await sweepStaleOrders();
    assert.equal(first.redispatched, 1);
    assert.equal(first.cancelled, 0);
    const row = await orderRow(order.id);
    assert.equal(row.order_status, "RIDER_REQUESTED");
    assert.ok(row.last_dispatched_at);

    const second = await sweepStaleOrders(); // straight away: not due again
    assert.equal(second.redispatched, 0);
  });

  it("leaves a fresh order alone", async () => {
    const order = await placeOrder(api, w);
    const result = await sweepStaleOrders();
    assert.deepEqual(result, { cancelled: 0, redispatched: 0, failed: 0 });
    assert.equal((await orderRow(order.id)).last_dispatched_at, null);
  });

  it("cancels an order nobody took in time, as the system", async () => {
    const order = await placeOrder(api, w);
    await age(order.id, 35);

    const result = await sweepStaleOrders();
    assert.equal(result.cancelled, 1);
    const row = await orderRow(order.id);
    assert.equal(row.order_status, "CANCELLED");
    assert.equal(row.cancelled_by_role, "SYSTEM");
    assert.match(row.cancel_reason, /No rider/);
    await assertNoMoneyMoved(order.id);

    assert.equal((await sweepStaleOrders()).cancelled, 0); // repeat is a no-op
  });

  it("never touches an order a rider already holds, however old", async () => {
    const order = await readyToDeliver(api, w);
    await age(order.id, 60 * 20);

    const result = await sweepStaleOrders();
    assert.equal(result.cancelled, 0);
    assert.equal((await orderRow(order.id)).order_status, "PICKED_UP");
  });

  it("the admin overview lists stuck orders and ignores healthy ones", async () => {
    const healthy = await placeOrder(api, w);
    const waiting = await placeOrder(api, w);
    await age(waiting.id, 15);
    const stuck = await readyToDeliver(api, w, w.riders[1]);
    await age(stuck.id, 60 * 6);

    const res = await api("GET", "/admin/overview", { token: w.adminToken });
    assert.equal(res.status, 200);
    const ids = res.body.data.stuck_orders.map((o) => o.id);
    assert.ok(ids.includes(waiting.id));
    assert.ok(ids.includes(stuck.id));
    assert.ok(!ids.includes(healthy.id));
    const row = res.body.data.stuck_orders.find((o) => o.id === stuck.id);
    assert.equal(row.order_status, "PICKED_UP");
    assert.ok(row.age_minutes >= 360);
    assert.ok(row.rider_name);
  });

  it("only sweeps its own state: a cancelled order is not listed as stuck", async () => {
    const order = await placeOrder(api, w);
    await age(order.id, 50);
    await adminCancel(order.id);
    const res = await api("GET", "/admin/overview", { token: w.adminToken });
    assert.equal(res.body.data.stuck_orders.length, 0);
  });
});
