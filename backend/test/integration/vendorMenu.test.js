import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld, nextPhone, pinAt } from "../helpers/fixtures.js";

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

const vendor = (m, p, body) => api(m, `/vendor${p}`, { token: w.vendorToken, body });
const checkout = (items) =>
  api("POST", "/marketplace/checkout", {
    body: {
      vendor_id: w.vendor.id,
      ...pinAt(1),
      customer_phone: nextPhone(),
      drop_address: "Near the mosque",
      items,
    },
  });
const add = async (body) => {
  const res = await vendor("POST", "/products", { name: "Chicken Biryani Full", price: "200.00", ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.product;
};
const stockOf = async (id) => (await prisma.product.findUnique({ where: { id } })).stock_qty;

describe("vendor menu management", () => {
  it("adds, edits and archives an item; archived items vanish everywhere", async () => {
    const p = await add({ stock_qty: 5 });
    assert.equal(p.effective_price, "200.00");
    const edited = await vendor("PATCH", `/products/${p.id}`, { price: "210.00", is_available: false });
    assert.equal(edited.body.data.product.price, "210.00");
    assert.equal(edited.body.data.product.is_available, false);
    assert.equal((await vendor("DELETE", `/products/${p.id}`)).status, 200);
    const me = await vendor("GET", "/me");
    assert.ok(!me.body.data.products.some((x) => x.id === p.id));
    const sale = await checkout([{ product_id: p.id, quantity: 1 }]);
    assert.equal(sale.status, 422);
  });

  it("refuses another hotel's item, a customer token, and a duplicate name", async () => {
    const p = await add({});
    const foreign = await api("PATCH", `/vendor/products/${p.id}`, { token: other.vendorToken, slug: "other", body: { price: "1.00" } });
    assert.ok([403, 404].includes(foreign.status), String(foreign.status));
    assert.equal((await api("POST", "/vendor/products", { token: w.riders[0].token, body: { name: "x1", price: "10" } })).status, 403);
    const dup = await vendor("POST", "/products", { name: "chicken biryani full", price: "10" });
    assert.equal(dup.status, 409);
  });

  it("validates price, offer and times", async () => {
    for (const bad of [
      { price: "0" },
      { offer_price: "200.00" },
      { offer_price: "250.00" },
      { offer_price: "100", offer_ends_at: "2020-01-01T00:00:00Z" },
      { available_from: "11:00" },
      { stock_qty: -1 },
    ]) {
      const res = await vendor("POST", "/products", { name: "Bad item", price: "200.00", ...bad });
      assert.equal(res.status, 422, JSON.stringify(bad));
    }
  });

  it("an active offer is the price the customer pays, and the item total follows it", async () => {
    const p = await add({ offer_price: "160.00", offer_label: "20% off" });
    assert.equal(p.effective_price, "160.00");
    const feed = await api("GET", "/marketplace/feed", {});
    const shown = feed.body.data.items[0].products.find((x) => x.id === p.id);
    assert.equal(shown.price, "160.00");
    assert.equal(shown.original_price, "200.00");
    const sale = await checkout([{ product_id: p.id, quantity: 1 }]);
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.data.item_total, "160.00");
    const row = await prisma.orderItem.findFirst({ where: { product_id: p.id } });
    assert.equal(row.unit_price.toString(), "160");
  });

  it("an expired offer is ignored; clearing the offer clears its label", async () => {
    const p = await add({ offer_price: "150.00", offer_label: "Sale" });
    await prisma.product.update({ where: { id: p.id }, data: { offer_ends_at: new Date(Date.now() - 1000) } });
    const sale = await checkout([{ product_id: p.id, quantity: 1 }]);
    assert.equal(sale.body.data.item_total, "200.00");
    const cleared = await vendor("PATCH", `/products/${p.id}`, { offer_price: null });
    assert.equal(cleared.body.data.product.offer_label, null);
  });

  it("stock falls with each order and the item sells out at zero", async () => {
    const p = await add({ stock_qty: 2 });
    assert.equal((await checkout([{ product_id: p.id, quantity: 1 }])).status, 201);
    assert.equal(await stockOf(p.id), 1);
    const feed = await api("GET", "/marketplace/feed", {});
    assert.equal(feed.body.data.items[0].products.find((x) => x.id === p.id).stock_left, 1);
    assert.equal((await checkout([{ product_id: p.id, quantity: 1 }])).status, 201);
    assert.equal(await stockOf(p.id), 0);
    const third = await checkout([{ product_id: p.id, quantity: 1 }]);
    assert.equal(third.status, 409);
    assert.equal(third.body.error.code, "OUT_OF_STOCK");
    const after = await api("GET", "/marketplace/feed", {});
    const grey = after.body.data.items[0].unavailable.find((x) => x.id === p.id);
    assert.equal(grey.reason, "SOLD_OUT");
    // asking for more than is left names the item and leaves the stock alone
    await vendor("PATCH", `/products/${p.id}`, { stock_qty: 1 });
    const over = await checkout([{ product_id: p.id, quantity: 2 }]);
    assert.equal(over.status, 409);
    assert.equal(await stockOf(p.id), 1);
  });

  it("two orders racing for the last portion: exactly one wins", async () => {
    const p = await add({ stock_qty: 1 });
    const results = await Promise.all([1, 2, 3].map(() => checkout([{ product_id: p.id, quantity: 1 }])));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(await stockOf(p.id), 0);
  });

  it("unlimited items (no stock) never run out", async () => {
    const p = await add({});
    for (let i = 0; i < 3; i++) assert.equal((await checkout([{ product_id: p.id, quantity: 2 }])).status, 201);
    assert.equal(await stockOf(p.id), null);
  });

  it("cancelling an order gives the portions back", async () => {
    const p = await add({ stock_qty: 3 });
    const sale = await checkout([{ product_id: p.id, quantity: 2 }]);
    assert.equal(await stockOf(p.id), 1);
    const cancel = await api("POST", `/orders/${(await prisma.order.findFirst({ orderBy: { id: "desc" } })).id}/cancel`, { token: w.adminToken, body: { reason: "Customer changed mind" } });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(await stockOf(p.id), 3);
  });

  it("uploads a photo: type and size are checked", async () => {
    const p = await add({});
    const send = (blob) => {
      const form = new FormData();
      form.set("image", blob, "x.jpg");
      return api("POST", `/vendor/products/${p.id}/image`, { token: w.vendorToken, form });
    };
    assert.equal((await send(new Blob(["nope"], { type: "application/pdf" }))).status, 422);
    assert.equal((await send(new Blob([new Uint8Array(5 * 1024 * 1024 + 10)], { type: "image/jpeg" }))).status, 422);
    const ok = await send(new Blob([new Uint8Array(2000)], { type: "image/jpeg" }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.data.product.image_url, /products\//);
  });
});
