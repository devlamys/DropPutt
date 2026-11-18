import "../helpers/env.js";
import assert from "node:assert/strict";
import { io as connect } from "socket.io-client";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeUser, makeWorld, nextPhone, pinAt } from "../helpers/fixtures.js";
import { accept, pickup, uuid } from "../helpers/flow.js";
import { cancelOrder } from "../../src/services/orderCancelService.js";
import { allocateGroupFees } from "../../src/services/checkoutService.js";

let server, api, w, vendor2, product2;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  // A second shop 2.5 km south of the first: 3.5 km from the drop pin, i.e. Zone 2 (40). The first shop is 1 km away (Zone 1, 30).
  const user = await makeUser(w.franchise.id, "VENDOR", "Second hotel");
  vendor2 = await prisma.vendor.create({
    data: {
      franchise_id: w.franchise.id,
      user_id: user.id,
      shop_name: "Second Hotel",
      address: "South Road",
      lat: (11.0 - 2.5 / 1.3 / 111.195).toFixed(7),
      lng: "76.0000000",
      commission_rate: 10,
      min_order_value: 50,
    },
  });
  product2 = await prisma.product.create({ data: { vendor_id: vendor2.id, name: "Parotta", price: 80 } });
});

const group = (extra = {}) =>
  api("POST", "/marketplace/checkout-group", {
    headers: { "Idempotency-Key": uuid() },
    body: {
      ...pinAt(1),
      customer_phone: nextPhone(),
      drop_address: "Near the mosque",
      carts: [
        { vendor_id: w.vendor.id, items: [{ product_id: w.products.biryani.id, quantity: 1 }] },
        { vendor_id: vendor2.id, items: [{ product_id: product2.id, quantity: 2 }] },
      ],
      ...extra,
    },
  });

describe("allocateGroupFees", () => {
  it("the farthest shop carries its zone fee, every other shop the extra stop fee", () => {
    const shares = allocateGroupFees([{ zone_fee: "30.00", km: 1 }, { zone_fee: "40.00", km: 3.5 }, { zone_fee: "30.00", km: 1.5 }], "20.00");
    assert.deepEqual(shares.map(String), ["20", "40", "20"]);
  });
  it("a tie on the zone fee goes to the shop that is farther away", () => {
    const shares = allocateGroupFees([{ zone_fee: "30.00", km: 1 }, { zone_fee: "30.00", km: 1.8 }], "20.00");
    assert.deepEqual(shares.map(String), ["20", "30"]);
  });
});

describe("deliver together (several shops, one trip)", () => {
  it("quotes the trip against separate orders", async () => {
    const res = await api("POST", "/marketplace/group-quote", { body: { vendor_ids: [w.vendor.id, vendor2.id], ...{ lat: pinAt(1).drop_lat, lng: pinAt(1).drop_lng } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.together_fee, "60.00"); // 40 + 20
    assert.equal(res.body.data.separate_fee, "70.00"); // 30 + 40
  });

  it("creates one order per shop in one group with the fee split", async () => {
    const res = await group();
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.delivery_fee, "60.00");
    assert.equal(res.body.data.orders.length, 2);
    const orders = await prisma.order.findMany({ orderBy: { id: "asc" } });
    assert.equal(orders.length, 2);
    assert.equal(orders[0].group_id, orders[1].group_id);
    assert.ok(orders[0].group_id);
    assert.deepEqual(orders.map((o) => String(o.group_delivery_fee)), ["20", "40"]);
    assert.ok(orders.every((o) => o.order_status === "RIDER_REQUESTED"));
  });

  it("a rider who accepts one order takes the whole trip; the other rider is refused", async () => {
    await group();
    const [first, second] = await prisma.order.findMany({ orderBy: { id: "asc" } });
    const a = await accept(api, w.riders[0], first.id);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const after = await prisma.order.findMany({ orderBy: { id: "asc" } });
    assert.ok(after.every((o) => o.rider_id === w.riders[0].rider.id && o.order_status === "RIDER_ASSIGNED"));
    const b = await accept(api, w.riders[1], second.id);
    assert.equal(b.status, 409);
  });

  it("pickup uses each order's share of the trip fee, and the rider keeps all of it", async () => {
    await group();
    const [first, second] = await prisma.order.findMany({ orderBy: { id: "asc" } });
    await accept(api, w.riders[0], first.id);
    for (const order of [first, second]) {
      const p = await pickup(api, w, w.riders[0], { id: order.id, phone: order.customer_phone });
      assert.equal(p.status, 200, JSON.stringify(p.body));
    }
    const done = await prisma.order.findMany({ orderBy: { id: "asc" } });
    assert.deepEqual(done.map((o) => String(o.delivery_fee)), ["20", "40"]);
    assert.deepEqual(done.map((o) => String(o.rider_earning)), ["20", "40"]);
    const sum = done.reduce((n, o) => n + Number(o.grand_total), 0);
    assert.equal(sum, 100 + 20 + 160 + 40); // items 100 + 160, fees 20 + 40
  });

  it("needs two to three different shops", async () => {
    const one = await group({ carts: [{ vendor_id: w.vendor.id, items: [{ product_id: w.products.biryani.id, quantity: 1 }] }] });
    assert.equal(one.status, 422, JSON.stringify(one.body));
    const same = await group({
      carts: [
        { vendor_id: w.vendor.id, items: [{ product_id: w.products.biryani.id, quantity: 1 }] },
        { vendor_id: w.vendor.id, items: [{ product_id: w.products.meals.id, quantity: 2 }] },
      ],
    });
    assert.equal(same.status, 422);
    assert.equal(await prisma.order.count(), 0);
  });

  it("a shop that is too far refuses the whole group and creates nothing", async () => {
    const res = await group({ ...pinAt(30) });
    assert.ok([400, 422].includes(res.status), JSON.stringify(res.body));
    assert.equal(await prisma.order.count(), 0);
  });

  it("the rain surge is charged once per trip, on the first order picked up", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { rain_surge_fee: 20 } });
    await group();
    const [first, second] = await prisma.order.findMany({ orderBy: { id: "asc" } });
    await accept(api, w.riders[0], first.id);
    for (const order of [first, second]) {
      const p = await pickup(api, w, w.riders[0], { id: order.id, phone: order.customer_phone });
      assert.equal(p.status, 200, JSON.stringify(p.body));
    }
    const done = await prisma.order.findMany({ orderBy: { id: "asc" } });
    assert.deepEqual(done.map((o) => o.rain_surge_applied), [true, false]);
    assert.deepEqual(done.map((o) => String(o.rider_tip)), ["20", "0"]);
  });

  it("cancelling an order re-shares the trip fee: the order that is left carries its own zone fee", async () => {
    await group();
    const [near, far] = await prisma.order.findMany({ orderBy: { id: "asc" } }); // shares 20 and 40
    await cancelOrder({ orderId: far.id, franchise_id: w.franchise.id, role: "CUSTOMER", franchise_slug: "tf" });
    const left = await prisma.order.findUnique({ where: { id: near.id } });
    assert.equal(String(left.group_delivery_fee), "30"); // Zone 1, no longer an extra stop
  });

  it("cancelling the lead order before any rider takes it calls riders again for the rest of the trip", async () => {
    const socket = connect(server.url, { auth: { token: w.riders[0].token }, transports: ["websocket"] });
    const requests = [];
    socket.on("new_rider_request", (e) => requests.push(e));
    await new Promise((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
    });
    try {
      await group();
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].group_size, 2);
      const [near, far] = await prisma.order.findMany({ orderBy: { id: "asc" } });
      assert.equal(requests[0].order_id, far.id); // the lead carries the most fee
      await cancelOrder({ orderId: far.id, franchise_id: w.franchise.id, role: "CUSTOMER", franchise_slug: "tf" });
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(requests.length, 2, "the remaining order is offered again");
      assert.equal(requests[1].order_id, near.id);
    } finally {
      socket.close();
    }
  });
});
