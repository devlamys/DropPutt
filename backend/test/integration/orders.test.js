import "../helpers/env.js";
import assert from "node:assert/strict";
import { io as connect } from "socket.io-client";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld, nextPhone } from "../helpers/fixtures.js";
import { accept, deliver, pickup, placeOrder, readyToDeliver, uuid } from "../helpers/flow.js";

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
  w = await makeWorld({ franchise: { rain_surge_fee: 0 } });
});

const orderRow = (id) => prisma.order.findUnique({ where: { id } });
const entries = (order_id) => prisma.settlementEntry.findMany({ where: { order_id } });
const riderRow = (i = 0) => prisma.rider.findUnique({ where: { id: w.riders[i].rider.id } });

describe("quick vendor call (§18)", () => {
  it("creates a RIDER_REQUESTED order with server-priced items", async () => {
    const order = await placeOrder(api, w, { items: [{ product_id: w.products.biryani.id, quantity: 3 }] });
    assert.equal(order.order_status, "RIDER_REQUESTED");
    assert.equal(order.item_total, "300.00");
    assert.ok(order.location_token.length >= 16);
  });

  it("same Idempotency-Key → cached response, no second order", async () => {
    const key = uuid();
    const send = () =>
      api("POST", "/orders/quick-call", {
        token: w.vendorToken,
        headers: { "Idempotency-Key": key },
        body: { customer_phone: nextPhone(), items: [{ product_id: w.products.biryani.id, quantity: 2 }] },
      });
    const first = await send();
    const second = await send();
    assert.equal(first.status, 201);
    assert.equal(second.body.data.order.id, first.body.data.order.id);
    assert.equal(await prisma.order.count(), 1);
  });

  it("franchise wallet at the minimum balance blocks new orders", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { wallet_balance: -50 } });
    const res = await api("POST", "/orders/quick-call", {
      token: w.vendorToken,
      body: { items: [{ product_id: w.products.biryani.id, quantity: 2 }] },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FRANCHISE_WALLET_LOW");
    assert.equal(await prisma.order.count(), 0);
  });

  it("only vendors and admins may call riders", async () => {
    const res = await api("POST", "/orders/quick-call", { token: w.riders[0].token, body: {} });
    assert.equal(res.status, 403);
  });
});

describe("rider acceptance race (§17)", () => {
  it("two riders accepting at once: exactly one wins", async () => {
    const order = await placeOrder(api, w);
    const [r1, r2] = await Promise.all([accept(api, w.riders[0], order.id), accept(api, w.riders[1], order.id)]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    assert.equal(loser.body.error.code, "ORDER_ALREADY_ACCEPTED");

    const row = await orderRow(order.id);
    assert.equal(row.order_status, "RIDER_ASSIGNED");
    const winner = r1.status === 200 ? w.riders[0] : w.riders[1];
    assert.equal(row.rider_id, winner.rider.id);
  });

  it("an offline rider cannot accept", async () => {
    await prisma.rider.update({ where: { id: w.riders[0].rider.id }, data: { is_online: false } });
    const order = await placeOrder(api, w);
    const res = await accept(api, w.riders[0], order.id);
    assert.equal(res.status, 403);
  });

  it("a rider at the cash limit cannot accept (§15)", async () => {
    await prisma.rider.update({ where: { id: w.riders[0].rider.id }, data: { cash_in_hand: 1500 } });
    const order = await placeOrder(api, w);
    const res = await accept(api, w.riders[0], order.id);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "CASH_LIMIT_EXCEEDED");
  });

  it("a rider at max active orders gets MAX_ORDERS_EXCEEDED", async () => {
    for (let i = 0; i < 2; i += 1) assert.equal((await accept(api, w.riders[0], (await placeOrder(api, w)).id)).status, 200);
    const third = await accept(api, w.riders[0], (await placeOrder(api, w)).id);
    assert.equal(third.status, 422);
    assert.equal(third.body.error.code, "MAX_ORDERS_EXCEEDED");
  });
});

describe("pickup money (§12–§14, §20)", () => {
  it("normal mode: item + zone fee, split four ways", async () => {
    const order = await placeOrder(api, w, { items: [{ product_id: w.products.biryani.id, quantity: 2 }] });
    await accept(api, w.riders[0], order.id);
    const res = await pickup(api, w, w.riders[0], order, { payment_method: "COD" });
    const o = res.body.data.order;
    assert.equal(o.item_total, "200.00");
    assert.equal(o.delivery_fee, "30.00");
    assert.equal(o.grand_total, "230.00");
    assert.equal(o.amount_to_collect, "230.00");
    const row = await orderRow(order.id);
    assert.equal(row.vendor_commission.toFixed(2), "20.00");
    assert.equal(row.vendor_earning.toFixed(2), "180.00");
    assert.equal(row.rider_earning.toFixed(2), "20.00"); // zone commission, no tip
    assert.equal(row.franchise_profit.toFixed(2), "27.00"); // 10 + 20 - 3
    assert.equal(row.super_admin_profit.toFixed(2), "3.00");
  });

  it("launch promo: rider keeps the whole delivery fee; franchise profit is not forced to zero", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { is_launch_promo_active: true } });
    const order = await placeOrder(api, w);
    await accept(api, w.riders[0], order.id);
    await pickup(api, w, w.riders[0], order);
    const row = await orderRow(order.id);
    assert.equal(row.rider_earning.toFixed(2), "30.00"); // full fee
    assert.equal(row.franchise_profit.toFixed(2), "17.00"); // commission 20 - royalty 3
    assert.equal(row.super_admin_profit.toFixed(2), "3.00");
  });

  it("rain surge: pickup twice adds the surge once", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { rain_surge_fee: 20 } });
    const order = await placeOrder(api, w);
    await accept(api, w.riders[0], order.id);
    const first = await pickup(api, w, w.riders[0], order);
    const second = await pickup(api, w, w.riders[0], order);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const row = await orderRow(order.id);
    assert.equal(row.rider_tip.toFixed(2), "20.00");
    assert.equal(row.rider_earning.toFixed(2), "40.00"); // 20 zone + 20 surge, once
    assert.equal(row.grand_total.toFixed(2), "250.00");
    assert.equal(await prisma.settlementEntry.count({ where: { order_id: order.id, type: "RAIN_SURGE" } }), 1);
  });

  it("amount_to_collect follows the payment method", async () => {
    const expected = { COD: "230.00", PREPAID_AT_HOTEL: "30.00", UPI_TO_ADMIN: "0.00" };
    for (const [payment_method, collect] of Object.entries(expected)) {
      const order = await placeOrder(api, w);
      await accept(api, w.riders[0], order.id);
      await pickup(api, w, w.riders[0], order, { payment_method });
      assert.equal((await orderRow(order.id)).amount_to_collect.toFixed(2), collect, payment_method);
      await deliver(api, w.riders[0], order.id); // free the rider's slot
    }
  });
});

describe("customer tip (§20)", () => {
  it("+₹20 raises tip, earning, total and amount to collect; the same action again changes nothing", async () => {
    const order = await readyToDeliver(api, w);
    const before = await orderRow(order.id);
    const action = uuid();
    const tip = () => api("POST", `/public/drop/${order.token}/tip`, { body: { tip: 20, client_action_id: action } });
    assert.equal((await tip()).status, 200);
    const once = await orderRow(order.id);
    assert.equal(once.rider_tip.minus(before.rider_tip).toFixed(2), "20.00");
    assert.equal(once.rider_earning.minus(before.rider_earning).toFixed(2), "20.00");
    assert.equal(once.grand_total.minus(before.grand_total).toFixed(2), "20.00");
    assert.equal(once.amount_to_collect.minus(before.amount_to_collect).toFixed(2), "20.00");

    assert.equal((await tip()).status, 200); // retry of the same action
    const twice = await orderRow(order.id);
    assert.equal(twice.rider_tip.toFixed(2), once.rider_tip.toFixed(2));
    assert.equal(twice.grand_total.toFixed(2), once.grand_total.toFixed(2));
    assert.equal(await prisma.settlementEntry.count({ where: { order_id: order.id, type: "RIDER_TIP" } }), 1);
  });

  it("a new action id is a new tip", async () => {
    const order = await readyToDeliver(api, w);
    for (const tip of [10, 30]) {
      await api("POST", `/public/drop/${order.token}/tip`, { body: { tip, client_action_id: uuid() } });
    }
    assert.equal((await orderRow(order.id)).rider_tip.toFixed(2), "40.00");
  });

  it("only 10 / 20 / 30 are accepted", async () => {
    const order = await readyToDeliver(api, w);
    for (const tip of [15, 0, -10, 100]) {
      const res = await api("POST", `/public/drop/${order.token}/tip`, { body: { tip, client_action_id: uuid() } });
      assert.equal(res.status, 422, `tip ${tip}`);
      assert.equal(res.body.error.code, "INVALID_TIP_AMOUNT");
    }
  });
});

describe("delivery settlement (§23–§25)", () => {
  it("COD: cash in hand grows by the grand total", async () => {
    const order = await readyToDeliver(api, w, w.riders[0], { payment_method: "COD" });
    const res = await deliver(api, w.riders[0], order.id);
    assert.equal(res.status, 200);
    const rider = await riderRow();
    assert.equal(rider.cash_in_hand.toFixed(2), "230.00");
    assert.equal(rider.wallet_earnings.toFixed(2), "20.00");
  });

  it("prepaid at hotel: only delivery + tip is cash", async () => {
    const order = await readyToDeliver(api, w, w.riders[0], { payment_method: "PREPAID_AT_HOTEL" });
    await deliver(api, w.riders[0], order.id);
    assert.equal((await riderRow()).cash_in_hand.toFixed(2), "30.00");
  });

  it("UPI to admin: no cash collected", async () => {
    const order = await readyToDeliver(api, w, w.riders[0], { payment_method: "UPI_TO_ADMIN" });
    await deliver(api, w.riders[0], order.id);
    assert.equal((await riderRow()).cash_in_hand.toFixed(2), "0.00");
  });

  it("delivering twice settles once: one royalty, vendor payable, rider earning, cash entry", async () => {
    const order = await readyToDeliver(api, w);
    const first = await deliver(api, w.riders[0], order.id, uuid());
    const second = await deliver(api, w.riders[0], order.id, uuid()); // different key: a true retry
    assert.equal(first.status, 200);
    assert.equal(second.status, 200, JSON.stringify(second.body));

    const rows = await entries(order.id);
    const count = (suffix) => rows.filter((e) => e.reference_key.endsWith(suffix)).length;
    for (const suffix of [":cash-collection", ":vendor-payable", ":rider-earning", ":royalty", ":franchise-profit"]) {
      assert.equal(count(suffix), 1, suffix);
    }
    assert.equal(await prisma.walletTransaction.count({ where: { order_id: order.id, type: "DEBIT" } }), 1);

    const rider = await riderRow();
    assert.equal(rider.cash_in_hand.toFixed(2), "230.00");
    assert.equal(rider.wallet_earnings.toFixed(2), "20.00");
    const vendor = await prisma.vendor.findUnique({ where: { id: w.vendor.id } });
    assert.equal(vendor.admin_payable_balance.toFixed(2), "180.00");
    const franchise = await prisma.franchise.findUnique({ where: { id: w.franchise.id } });
    assert.equal(franchise.wallet_balance.toFixed(2), "-3.00");
  });

  it("the same Idempotency-Key replays the cached delivery response", async () => {
    const order = await readyToDeliver(api, w);
    const key = uuid();
    const first = await deliver(api, w.riders[0], order.id, key);
    const second = await deliver(api, w.riders[0], order.id, key);
    assert.equal(second.status, first.status);
    assert.equal(await prisma.walletTransaction.count({ where: { order_id: order.id } }), 1);
  });

  it("a rider cannot deliver someone else's order", async () => {
    const order = await readyToDeliver(api, w, w.riders[0]);
    const res = await deliver(api, w.riders[1], order.id);
    assert.equal(res.status, 403);
  });

  it("the order must be picked up before it can be delivered", async () => {
    const order = await placeOrder(api, w);
    await accept(api, w.riders[0], order.id);
    const res = await deliver(api, w.riders[0], order.id);
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
    assert.equal((await orderRow(order.id)).order_status, "RIDER_ASSIGNED");
  });
});

describe("daily milestone (§25)", () => {
  it("bonus is granted once at exactly the target; the event fires; a retry grants nothing", async () => {
    await prisma.franchise.update({
      where: { id: w.franchise.id },
      data: { daily_milestone_target: 2, daily_milestone_bonus: 50 },
    });
    const socket = connect(server.url, { auth: { token: w.riders[0].token }, transports: ["websocket"] });
    const events = [];
    socket.on("milestone_achieved", (e) => events.push(e));
    await new Promise((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
    });
    try {
      const o1 = await readyToDeliver(api, w);
      await deliver(api, w.riders[0], o1.id);
      assert.equal(await prisma.settlementEntry.count({ where: { type: "MILESTONE_BONUS" } }), 0);

      const o2 = await readyToDeliver(api, w);
      await deliver(api, w.riders[0], o2.id);
      assert.equal(await prisma.settlementEntry.count({ where: { type: "MILESTONE_BONUS" } }), 1);
      assert.equal((await riderRow()).wallet_earnings.toFixed(2), "90.00"); // 20 + 20 + 50

      await deliver(api, w.riders[0], o2.id, uuid()); // repeated request
      assert.equal(await prisma.settlementEntry.count({ where: { type: "MILESTONE_BONUS" } }), 1);
      assert.equal((await riderRow()).wallet_earnings.toFixed(2), "90.00");

      const o3 = await readyToDeliver(api, w); // 3rd delivery: past the target
      await deliver(api, w.riders[0], o3.id);
      assert.equal(await prisma.settlementEntry.count({ where: { type: "MILESTONE_BONUS" } }), 1);

      await new Promise((r) => setTimeout(r, 200));
      assert.equal(events.length, 1);
      assert.equal(events[0].target, 2);
      assert.equal(Number(events[0].bonus), 50);
    } finally {
      socket.close();
    }
  });
});

describe("public tracking REST fallback (§52.3)", () => {
  it("exposes status and position, never identity or money", async () => {
    const order = await readyToDeliver(api, w);
    const res = await api("GET", `/public/drop/${order.token}/status`, {});
    assert.equal(res.status, 200);
    const text = JSON.stringify(res.body.data);
    assert.equal(res.body.data.order_status, "PICKED_UP");
    for (const secret of [w.riders[0].user.phone, w.riders[0].user.name, "amount", "earning", "wallet", "commission"]) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
  });

  it("an unknown token is a 404, not a crash", async () => {
    const res = await api("GET", "/public/drop/not-a-real-token-1234567890/status", {});
    assert.equal(res.status, 404);
  });
});
