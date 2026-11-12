import "../helpers/env.js";
import assert from "node:assert/strict";
import { io as connect } from "socket.io-client";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld, nextPhone } from "../helpers/fixtures.js";
import { accept, pickup, placeOrder, uuid } from "../helpers/flow.js";

let server, api, w, other;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  other = await makeOtherWorld();
});

const checkout = (body, headers) =>
  api("POST", "/marketplace/checkout", {
    headers,
    body: {
      vendor_id: w.vendor.id,
      zone_id: w.zones[0].id,
      customer_phone: nextPhone(),
      drop_address: "Near the mosque",
      ...body,
    },
  });
const item = (p, quantity) => ({ product_id: p.id, quantity });

describe("marketplace cart rules (§7, §42)", () => {
  it("one order, one item", async () => {
    const res = await checkout({ items: [item(w.products.biryani, 2)] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.item_total, "200.00");
  });

  it("one order, several products", async () => {
    const res = await checkout({ items: [item(w.products.biryani, 1), item(w.products.meals, 2)] });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.items.length, 2);
    assert.equal(res.body.data.item_total, "220.00"); // 100 + 2×60
  });

  it("the same product repeated merges into one OrderItem", async () => {
    const res = await checkout({ items: [item(w.products.biryani, 1), item(w.products.biryani, 2), item(w.products.meals, 1)] });
    assert.equal(res.status, 201);
    const order = await prisma.order.findFirst({ include: { items: true } });
    assert.equal(order.items.length, 2);
    assert.equal(order.items.find((i) => i.product_id === w.products.biryani.id).quantity, 3);
    assert.equal(res.body.data.item_total, "360.00");
  });

  it("the server recalculates prices; client-sent prices and totals are ignored", async () => {
    const res = await checkout({
      item_total: "1.00",
      items: [{ product_id: w.products.biryani.id, quantity: 2, unit_price: "1.00", line_total: "2.00" }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.item_total, "200.00");
    const row = await prisma.orderItem.findFirst();
    assert.equal(row.unit_price.toFixed(2), "100.00");
    assert.equal(row.line_total.toFixed(2), "200.00");
  });

  it("estimate = items + the zone's delivery fee", async () => {
    const res = await checkout({ zone_id: w.zones[1].id, items: [item(w.products.biryani, 2)] });
    assert.equal(res.body.data.delivery_fee, "40.00");
    assert.equal(res.body.data.estimated_total, "240.00");
  });

  it("a product from another franchise is rejected", async () => {
    const res = await checkout({ items: [item(other.products.biryani, 2)] });
    assert.equal(res.status, 422);
    assert.equal(await prisma.order.count(), 0);
  });

  it("a shop from another franchise is rejected", async () => {
    const res = await checkout({ vendor_id: other.vendor.id, items: [item(other.products.biryani, 2)] });
    assert.equal(res.status, 422);
  });

  it("an unavailable product is rejected", async () => {
    const res = await checkout({ items: [item(w.products.unavailable, 3), item(w.products.biryani, 1)] });
    assert.equal(res.status, 422);
    assert.match(JSON.stringify(res.body.error.details), /not available/);
  });

  it("a product outside its time window is rejected by the backend", async () => {
    // from == to is an empty window: never available, whatever the clock says.
    const never = await prisma.product.create({
      data: { vendor_id: w.vendor.id, name: "Never", price: 150, available_from: "10:00", available_to: "10:00" },
    });
    const res = await checkout({ items: [item(never, 1)] });
    assert.equal(res.status, 422);
    assert.match(JSON.stringify(res.body.error.details), /not available/);
    const feed = await api("GET", "/marketplace/feed", {});
    const names = feed.body.data.items[0].products.map((p) => p.name);
    assert.ok(!names.includes("Never"));
    assert.ok(!names.includes("Sold out"));
  });

  it("below the shop's minimum order is rejected", async () => {
    const res = await checkout({ items: [item(w.products.meals, 1)] }); // ₹60 < ₹100
    assert.equal(res.status, 422);
    assert.match(JSON.stringify(res.body.error.details), /minimum order value/);
  });

  it("a closed shop is rejected", async () => {
    await prisma.vendor.update({ where: { id: w.vendor.id }, data: { is_open: false } });
    const res = await checkout({ items: [item(w.products.biryani, 2)] });
    assert.equal(res.status, 422);
    const feed = await api("GET", "/marketplace/feed", {});
    assert.equal(feed.body.data.items.length, 0);
  });

  it("quantities and bodies are validated", async () => {
    for (const bad of [{ items: [item(w.products.biryani, 0)] }, { items: [item(w.products.biryani, 100)] }, { items: [] }, { customer_phone: "123", items: [item(w.products.biryani, 2)] }, { drop_address: "", items: [item(w.products.biryani, 2)] }]) {
      assert.equal((await checkout(bad)).status, 422, JSON.stringify(bad));
    }
    assert.equal(await prisma.order.count(), 0);
  });
});

describe("checkout flow", () => {
  it("creates the order, registers the customer and calls riders", async () => {
    const rider = w.riders[0];
    const socket = connect(server.url, { auth: { token: rider.token }, transports: ["websocket"] });
    const requests = [];
    socket.on("new_rider_request", (e) => requests.push(e));
    await new Promise((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
    });
    try {
      const phone = nextPhone();
      const res = await checkout({ customer_phone: phone, customer_name: "Ravi", items: [item(w.products.biryani, 2)] });
      assert.equal(res.status, 201);
      const order = await prisma.order.findFirst();
      assert.equal(order.order_status, "RIDER_REQUESTED");
      assert.equal(order.order_type, "FOOD_MARKETPLACE");
      assert.equal(order.franchise_id, w.franchise.id);
      assert.equal(order.location_token, res.body.data.location_token);
      const customer = await prisma.customer.findFirst({ where: { phone } });
      assert.equal(customer.name, "Ravi");
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].order_id, order.id);
    } finally {
      socket.close();
    }
  });

  it("the rider's bill matches what the customer was shown", async () => {
    const res = await checkout({ items: [item(w.products.biryani, 2)] });
    const order = await prisma.order.findFirst();
    await accept(api, w.riders[0], order.id);
    const picked = await pickup(api, w, w.riders[0], { id: order.id, phone: order.customer_phone });
    assert.equal(picked.body.data.order.grand_total, res.body.data.estimated_total);
  });

  it("the same Idempotency-Key never creates a second order", async () => {
    const key = uuid();
    const body = { customer_phone: nextPhone(), items: [item(w.products.biryani, 2)] };
    const first = await checkout(body, { "Idempotency-Key": key });
    const second = await checkout(body, { "Idempotency-Key": key });
    assert.equal(second.body.data.order_number, first.body.data.order_number);
    assert.equal(await prisma.order.count(), 1);
  });

  it("one phone number is limited to 5 checkouts per 10 minutes", async () => {
    const phone = nextPhone();
    let last;
    for (let i = 0; i < 6; i += 1) last = await checkout({ customer_phone: phone, items: [item(w.products.biryani, 2)] });
    assert.equal(last.status, 429);
    assert.equal(await prisma.order.count(), 5);
  });

  it("a low franchise wallet pauses delivery", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { wallet_balance: -50 } });
    const res = await checkout({ items: [item(w.products.biryani, 2)] });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FRANCHISE_WALLET_LOW");
  });

  it("vendor quick-call merges repeated products too", async () => {
    const order = await placeOrder(api, w, {
      items: [item(w.products.biryani, 1), item(w.products.biryani, 1)],
    });
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].quantity, 2);
  });
});

describe("feed ordering (§26, §40)", () => {
  it("lists only this franchise's open shops, with category chips", async () => {
    const feed = await api("GET", "/marketplace/feed", {});
    assert.equal(feed.status, 200);
    assert.equal(feed.body.data.items.length, 1);
    assert.ok(feed.body.data.categories.some((c) => c.key === "FOOD"));
    assert.equal(typeof feed.body.data.is_chayakadi_window, "boolean");
    assert.ok(feed.body.meta.pagination);
  });
});
