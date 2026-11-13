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
    // ...but the menu can still show them greyed out, with the reason.
    const greyed = Object.fromEntries(feed.body.data.items[0].unavailable.map((p) => [p.name, p]));
    assert.equal(greyed["Sold out"].reason, "SOLD_OUT");
    assert.equal(greyed.Never.reason, "OUT_OF_SLOT");
    assert.equal(greyed.Never.available_window, "10 AM – 10 AM");
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

describe("custom orders: Buy Anything, Pick & Drop, Mini Truck", () => {
  const customOrder = (body, headers) =>
    api("POST", "/marketplace/orders", {
      headers,
      body: {
        zone_id: w.zones[0].id,
        customer_phone: nextPhone(),
        customer_name: "Ravi",
        drop_address: "Blue gate house, near the mosque",
        ...body,
      },
    });

  it("Buy Anything: stores the list, no shop needed, rider is called", async () => {
    const res = await customOrder({ order_type: "CUSTOM_BUY", details: "1 kg rice, 2 packets milk", shop_name: "Hari Stores" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.order_type, "CUSTOM_BUY");
    assert.equal(res.body.data.delivery_fee, "30.00");
    const order = await prisma.order.findFirst();
    assert.equal(order.order_type, "CUSTOM_BUY");
    assert.equal(order.order_status, "RIDER_REQUESTED");
    assert.equal(order.vendor_id, null);
    assert.equal(order.custom_items_text, "1 kg rice, 2 packets milk");
    assert.equal(order.custom_shop_name, "Hari Stores");
    assert.equal(order.franchise_id, w.franchise.id);
    assert.equal(order.item_total.toFixed(2), "0.00");
  });

  it("Pick & Drop needs a collection address", async () => {
    const missing = await customOrder({ order_type: "PICK_DROP", details: "Parcel for my brother" });
    assert.equal(missing.status, 422);
    assert.match(JSON.stringify(missing.body.error.details), /pickup_address/);
    const ok = await customOrder({ order_type: "PICK_DROP", details: "Parcel for my brother", pickup_address: "Near the bus stand" });
    assert.equal(ok.status, 201);
    const order = await prisma.order.findFirst({ where: { order_type: "PICK_DROP" } });
    assert.equal(order.pickup_address, "Near the bus stand");
    assert.equal(order.order_category, "PICK_DROP");
  });

  it("Mini Truck is only offered to mini-truck riders", async () => {
    const bikeRider = connect(server.url, { auth: { token: w.riders[0].token }, transports: ["websocket"] });
    const bikeSeen = [];
    bikeRider.on("new_rider_request", (e) => bikeSeen.push(e));
    await new Promise((resolve, reject) => {
      bikeRider.on("connect", resolve);
      bikeRider.on("connect_error", reject);
    });
    try {
      const res = await customOrder({ order_type: "MINI_TRUCK", details: "Sofa and two chairs", pickup_address: "Old house, Main Road" });
      assert.equal(res.status, 201);
      await new Promise((r) => setTimeout(r, 250));
      assert.equal(bikeSeen.length, 0, "a bike rider must not be called for a mini truck");
      assert.equal((await prisma.order.findFirst()).order_type, "MINI_TRUCK");
    } finally {
      bikeRider.close();
    }
  });

  it("flows through the rider: accept, then pickup with the bill the rider enters", async () => {
    await customOrder({ order_type: "CUSTOM_BUY", details: "Paracetamol strip", shop_name: "City Medicals" });
    const order = await prisma.order.findFirst();
    assert.equal((await accept(api, w.riders[0], order.id)).status, 200);
    const res = await api("PUT", `/orders/${order.id}/rider-pickup`, {
      token: w.riders[0].token,
      body: { customer_phone: order.customer_phone, zone_id: w.zones[0].id, payment_method: "COD", item_total: "45", rider_paid_at_shop: true },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order.grand_total, "75.00"); // ₹45 purchase + ₹30 delivery
  });

  it("validates the body and the franchise", async () => {
    for (const bad of [
      { order_type: "TELEPORT", details: "x y z" },
      { order_type: "CUSTOM_BUY" }, // nothing to buy
      { order_type: "CUSTOM_BUY", items: "not json" },
      { order_type: "CUSTOM_BUY", items: [{ name: "Rice", qty: 0 }] },
      { order_type: "CUSTOM_BUY", items: Array.from({ length: 31 }, (_, i) => ({ name: `Item ${i}`, qty: 1 })) },
      { order_type: "CUSTOM_BUY", details: "milk", customer_phone: "123" },
      { order_type: "CUSTOM_BUY", details: "milk", drop_address: "" },
      { order_type: "CUSTOM_BUY", details: "milk", zone_id: other.zones[0].id },
      { order_type: "CUSTOM_BUY", details: "milk", zone_id: 99999999999 },
    ]) {
      assert.equal((await customOrder(bad)).status, 422, JSON.stringify(bad));
    }
    assert.equal(await prisma.order.count(), 0);
  });

  it("is idempotent, rate limited per phone, and respects the wallet gate", async () => {
    const key = uuid();
    const body = { order_type: "CUSTOM_BUY", details: "tea powder", customer_phone: nextPhone() };
    const first = await customOrder(body, { "Idempotency-Key": key });
    const again = await customOrder(body, { "Idempotency-Key": key });
    assert.equal(again.body.data.order_number, first.body.data.order_number);
    assert.equal(await prisma.order.count(), 1);

    const phone = nextPhone();
    let last;
    for (let i = 0; i < 6; i += 1) last = await customOrder({ order_type: "CUSTOM_BUY", details: "tea powder", customer_phone: phone });
    assert.equal(last.status, 429);

    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { wallet_balance: -50 } });
    const blocked = await customOrder({ order_type: "CUSTOM_BUY", details: "tea powder" });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, "FRANCHISE_WALLET_LOW");
  });

  it("the feed names the franchise for the storefront header", async () => {
    const feed = await api("GET", "/marketplace/feed", {});
    assert.equal(feed.body.data.franchise.name, w.franchise.name);
    assert.equal(feed.body.data.franchise.slug, "tf");
  });

  const multipart = (fields, files = {}) => {
    const form = new FormData();
    const base = { order_type: "CUSTOM_BUY", zone_id: w.zones[0].id, customer_phone: nextPhone(), drop_address: "Blue gate house", ...fields };
    for (const [key, value] of Object.entries(base)) form.set(key, typeof value === "string" ? value : JSON.stringify(value));
    if (files.photo) form.set("photo", files.photo, "list.jpg");
    if (files.voice) form.set("voice", files.voice, "note.webm");
    return api("POST", "/marketplace/orders", { form });
  };
  const bytes = (type, size = 3000) => new Blob([new Uint8Array(size)], { type });

  it("Buy Anything checklist becomes a readable list for the rider", async () => {
    const res = await multipart({
      shop_name: "City Medicals",
      items: [{ name: "Paracetamol 500mg", qty: 2 }, { name: "Cough syrup", qty: 1 }],
      details: "Same brand as last time",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = await prisma.order.findFirst();
    assert.equal(order.custom_items_text, "• 2 × Paracetamol 500mg\n• 1 × Cough syrup\n\nNote: Same brand as last time");
    assert.equal(order.custom_shop_name, "City Medicals");
  });

  it("a list photo and a voice note are stored and shown to the assigned rider", async () => {
    const res = await multipart({ shop_name: "Hari Stores" }, { photo: bytes("image/jpeg"), voice: bytes("audio/webm;codecs=opus") });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.has_photo, true);
    assert.equal(res.body.data.has_voice_note, true);
    const order = await prisma.order.findFirst();
    assert.ok(order.prescription_img_url && order.request_voice_url);
    assert.notEqual(order.prescription_img_url, order.request_voice_url);
    // the customer's own navigation voice route is a different field and stays free
    assert.equal(order.voice_note_url, null);

    await accept(api, w.riders[0], order.id);
    const active = await api("GET", "/orders/active", { token: w.riders[0].token });
    const seen = active.body.data.orders[0];
    assert.equal(seen.request_image_url, order.prescription_img_url);
    assert.equal(seen.request_voice_url, order.request_voice_url);
  });

  it("a photo alone, or a voice note alone, is a valid request", async () => {
    assert.equal((await multipart({}, { photo: bytes("image/png") })).status, 201);
    assert.equal((await multipart({}, { voice: bytes("audio/webm") })).status, 201);
    assert.equal(await prisma.order.count(), 2);
  });

  it("rejects the wrong file types and oversized photos, and stores nothing", async () => {
    assert.equal((await multipart({}, { photo: bytes("application/pdf") })).status, 422);
    assert.equal((await multipart({}, { photo: bytes("text/html") })).status, 422);
    assert.equal((await multipart({}, { voice: bytes("image/jpeg") })).status, 422);
    const big = await multipart({}, { photo: bytes("image/jpeg", 5 * 1024 * 1024 + 10) });
    assert.equal(big.status, 422);
    assert.match(JSON.stringify(big.body.error.details), /5 MB/);
    assert.equal(await prisma.order.count(), 0);
  });
});

describe("checkout: payment method and turning point", () => {
  const place = (extra = {}) =>
    api("POST", "/marketplace/checkout", {
      body: {
        vendor_id: w.vendor.id,
        zone_id: w.zones[0].id,
        customer_phone: nextPhone(),
        drop_address: "Blue gate house",
        items: [{ product_id: w.products.biryani.id, quantity: 2 }],
        ...extra,
      },
    });

  it("defaults to cash on delivery", async () => {
    const res = await place();
    assert.equal(res.status, 201);
    assert.equal(res.body.data.payment_method, "COD");
    assert.equal(res.body.data.cash_to_rider, "230.00");
    assert.equal((await prisma.order.findFirst()).payment_method, "COD");
  });

  it("UPI_TO_ADMIN is stored, and the rider then collects nothing", async () => {
    const res = await place({ payment_method: "UPI_TO_ADMIN" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.payment_method, "UPI_TO_ADMIN");
    assert.equal(res.body.data.cash_to_rider, "0.00");
    const order = await prisma.order.findFirst();
    assert.equal(order.payment_method, "UPI_TO_ADMIN");

    // The rider's pickup keeps the customer's choice: full bill, no cash due.
    await accept(api, w.riders[0], order.id);
    const picked = await api("PUT", `/orders/${order.id}/rider-pickup`, {
      token: w.riders[0].token,
      body: { customer_phone: order.customer_phone, zone_id: w.zones[0].id },
    });
    assert.equal(picked.status, 200, JSON.stringify(picked.body));
    assert.equal(picked.body.data.order.payment_method, "UPI_TO_ADMIN");
    assert.equal(picked.body.data.order.grand_total, "230.00");
    assert.equal(picked.body.data.order.amount_to_collect, "0.00");
  });

  it("customers cannot pick any other payment method", async () => {
    for (const payment_method of ["PREPAID_AT_HOTEL", "BITCOIN", ""]) {
      assert.equal((await place({ payment_method })).status, 422, payment_method);
    }
    assert.equal(await prisma.order.count(), 0);
  });

  it("the turning point lands on the order and is remembered for the customer", async () => {
    const phone = nextPhone();
    const res = await place({ customer_phone: phone, turning_point: "Opposite the old mosque, blue gate" });
    assert.equal(res.status, 201);
    const order = await prisma.order.findFirst();
    assert.equal(order.turning_point, "Opposite the old mosque, blue gate");
    const customer = await prisma.customer.findFirst({ where: { phone } });
    assert.equal(customer.turning_point, "Opposite the old mosque, blue gate");

    // The rider sees it before pickup.
    await accept(api, w.riders[0], order.id);
    const active = await api("GET", "/orders/active", { token: w.riders[0].token });
    assert.equal(active.body.data.orders[0].turning_point, "Opposite the old mosque, blue gate");
  });

  it("a one-character turning point is rejected", async () => {
    assert.equal((await place({ turning_point: "x" })).status, 422);
  });
});
