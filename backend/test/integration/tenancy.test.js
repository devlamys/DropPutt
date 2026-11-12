import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { PIN, makeOtherWorld, makeWorld, nextPhone } from "../helpers/fixtures.js";
import { accept, placeOrder, uuid } from "../helpers/flow.js";

let server, api, a, b;
before(async () => {
  server = await startServer();
  api = client(server.url);
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  a = await makeWorld();
  b = await makeOtherWorld();
});

describe("tenant uniqueness (§42)", () => {
  it("same phone + same franchise → rejected", async () => {
    const phone = nextPhone();
    const first = await api("POST", "/customers", { token: a.adminToken, slug: "tf", body: { phone, name: "Ravi" } });
    assert.equal(first.status, 201);
    const again = await api("POST", "/customers", { token: a.adminToken, slug: "tf", body: { phone } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "CUSTOMER_EXISTS");
  });

  it("same phone + different franchise → allowed", async () => {
    const phone = nextPhone();
    const first = await api("POST", "/customers", { token: a.adminToken, slug: "tf", body: { phone } });
    const second = await api("POST", "/customers", { token: b.adminToken, slug: "other", body: { phone } });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(await prisma.customer.count({ where: { phone } }), 2);
  });

  it("phone numbers are normalised before storage", async () => {
    const res = await api("POST", "/customers", {
      token: a.adminToken,
      slug: "tf",
      body: { phone: "+91 98765-43210" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.phone, "9876543210");
    const dup = await api("POST", "/customers", { token: a.adminToken, slug: "tf", body: { phone: "09876543210" } });
    assert.equal(dup.status, 409);
  });
});

describe("tenant isolation", () => {
  it("customer lookup never crosses franchises", async () => {
    const phone = nextPhone();
    await prisma.customer.create({
      data: { franchise_id: a.franchise.id, phone, name: "Only in A", is_location_verified: true },
    });
    const own = await api("GET", `/orders/customer-lookup?phone=${phone}`, { token: a.riders[0].token, slug: "tf" });
    assert.equal(own.body.data.found, true);
    const other = await api("GET", `/orders/customer-lookup?phone=${phone}`, { token: b.riders[0].token, slug: "other" });
    assert.equal(other.status, 200);
    assert.equal(other.body.data.found, false);
    assert.equal(other.body.data.name, null);
  });

  it("login never resolves a user from another franchise", async () => {
    const phone = (await prisma.user.findUnique({ where: { id: a.riders[0].user.id } })).phone;
    const ok = await api("POST", "/auth/login", { slug: "tf", body: { phone, pin: PIN } });
    assert.equal(ok.status, 200);
    const wrong = await api("POST", "/auth/login", { slug: "other", body: { phone, pin: PIN } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, "UNAUTHENTICATED");
  });

  it("a token for franchise A is refused under franchise B's header", async () => {
    const res = await api("GET", "/rider/me", { token: a.riders[0].token, slug: "other" });
    assert.equal(res.status, 403);
  });

  it("a rider cannot see or accept another franchise's order", async () => {
    const placed = await placeOrder((m, p, o) => api(m, p, { slug: "tf", ...o }), a);
    const res = await accept((m, p, o) => api(m, p, { slug: "other", ...o }), b.riders[0], placed.id);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "ORDER_NOT_FOUND");
    const list = await api("GET", "/orders", { token: b.adminToken, slug: "other" });
    assert.equal(list.body.data.orders.length, 0);
  });

  it("a client-supplied franchise_id is never the authority", async () => {
    const res = await api("POST", "/orders/quick-call", {
      token: a.vendorToken,
      slug: "tf",
      headers: { "Idempotency-Key": uuid() },
      body: {
        franchise_id: b.franchise.id,
        customer_phone: nextPhone(),
        items: [{ product_id: a.products.biryani.id, quantity: 2 }],
      },
    });
    assert.equal(res.status, 201);
    const row = await prisma.order.findFirst({ where: { id: res.body.data.order.id } });
    assert.equal(row.franchise_id, a.franchise.id);
  });

  it("marketplace feed and checkout stay inside the franchise", async () => {
    const feed = await api("GET", "/marketplace/feed", { slug: "other" });
    const names = feed.body.data.items.map((v) => v.shop_name);
    assert.deepEqual(names, [b.vendor.shop_name]);

    // Shop and product from franchise A, requested under franchise B.
    const res = await api("POST", "/marketplace/checkout", {
      slug: "other",
      body: {
        vendor_id: a.vendor.id,
        zone_id: b.zones[0].id,
        customer_phone: nextPhone(),
        drop_address: "Somewhere",
        items: [{ product_id: a.products.biryani.id, quantity: 2 }],
      },
    });
    assert.equal(res.status, 422);
  });
});
