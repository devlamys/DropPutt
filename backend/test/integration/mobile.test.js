import "../helpers/env.js";
import assert from "node:assert/strict";
import { io as connect } from "socket.io-client";
import { after, before, beforeEach, describe, it } from "node:test";
import { env } from "../../src/config/env.js";
import { runCampaigns } from "../../src/cron/pushScheduler.js";
import { setMessagingClientForTests } from "../../src/utils/push.js";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld, nextPhone } from "../helpers/fixtures.js";
import { accept, deliver, placeOrder, readyToDeliver, uuid, waitFor } from "../helpers/flow.js";

let server, api, w;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(async () => {
  setMessagingClientForTests(undefined);
  await server.close();
});
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  setMessagingClientForTests(undefined);
});

const fcmToken = () => "fcm-token-" + uuid() + uuid();

describe("device registration (§49.3)", () => {
  it("a new device creates an active row", async () => {
    const token = fcmToken();
    const res = await api("POST", "/device/register", {
      token: w.riders[0].token,
      body: { fcm_token: token, platform: "android", app_version: "1.2.3" },
    });
    assert.equal(res.status, 200);
    const row = await prisma.deviceRegistration.findUnique({ where: { fcm_token: token } });
    assert.equal(row.is_active, true);
    assert.equal(row.user_id, w.riders[0].user.id);
    assert.equal(row.app_version, "1.2.3");
  });

  it("registering the same token again upserts: no duplicate, version and last_seen updated", async () => {
    const token = fcmToken();
    const send = (app_version) =>
      api("POST", "/device/register", { token: w.riders[0].token, body: { fcm_token: token, platform: "android", app_version } });
    await send("1.0.0");
    const first = await prisma.deviceRegistration.findUnique({ where: { fcm_token: token } });
    await new Promise((r) => setTimeout(r, 20));
    await send("1.0.1");
    assert.equal(await prisma.deviceRegistration.count({ where: { fcm_token: token } }), 1);
    const second = await prisma.deviceRegistration.findUnique({ where: { fcm_token: token } });
    assert.equal(second.app_version, "1.0.1");
    assert.ok(second.last_seen_at > first.last_seen_at);
  });

  it("a token that moves to another account is reassigned", async () => {
    const token = fcmToken();
    await api("POST", "/device/register", { token: w.riders[0].token, body: { fcm_token: token, platform: "android" } });
    await api("POST", "/device/register", { token: w.riders[1].token, body: { fcm_token: token, platform: "android" } });
    const rows = await prisma.deviceRegistration.findMany({ where: { fcm_token: token } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, w.riders[1].user.id);
    assert.equal(rows[0].is_active, true);
  });

  it("a customer registers with the Magic Link token", async () => {
    const order = await readyToDeliver(api, w);
    const token = fcmToken();
    const res = await api("POST", "/device/register", { body: { fcm_token: token, platform: "web", location_token: order.token } });
    assert.equal(res.status, 200);
    const row = await prisma.deviceRegistration.findUnique({ where: { fcm_token: token } });
    assert.ok(row.customer_id);
    assert.equal(row.user_id, null);
  });

  it("rejects anonymous, invalid and malformed registrations", async () => {
    const anon = await api("POST", "/device/register", { body: { fcm_token: fcmToken(), platform: "android" } });
    assert.equal(anon.status, 422);
    const bad = await api("POST", "/device/register", { token: "garbage", body: { fcm_token: fcmToken(), platform: "android" } });
    assert.equal(bad.status, 401);
    const noPlatform = await api("POST", "/device/register", { token: w.riders[0].token, body: { fcm_token: fcmToken(), platform: "toaster" } });
    assert.equal(noPlatform.status, 422);
    const fakeLink = await api("POST", "/device/register", { body: { fcm_token: fcmToken(), platform: "web", location_token: "x".repeat(24) } });
    assert.equal(fakeLink.status, 401);
  });
});

describe("push notifications (§51)", () => {
  function fakeMessaging({ dead = [] } = {}) {
    const calls = [];
    setMessagingClientForTests({
      async sendEachForMulticast(message) {
        calls.push(message);
        const responses = message.tokens.map((t) =>
          dead.includes(t)
            ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
            : { success: true }
        );
        return {
          successCount: responses.filter((r) => r.success).length,
          failureCount: responses.filter((r) => !r.success).length,
          responses,
        };
      },
    });
    return calls;
  }
  const register = (user, token) =>
    prisma.deviceRegistration.create({ data: { user_id: user.id, fcm_token: token, platform: "android" } });

  it("a new order pushes every online rider's device with a deep link", async () => {
    const calls = fakeMessaging();
    const t1 = fcmToken();
    const t2 = fcmToken();
    await register(w.riders[0].user, t1);
    await register(w.riders[1].user, t2);
    const order = await placeOrder(api, w);
    const sent = calls.flatMap((c) => c.tokens);
    assert.ok(sent.includes(t1) && sent.includes(t2));
    assert.equal(calls[0].data.deep_link, `dropputt://orders/${order.id}`);
    assert.equal(calls[0].notification.title, "🛵 New Order!");
  });

  it("an offline rider's device is not pushed", async () => {
    const calls = fakeMessaging();
    const t = fcmToken();
    await register(w.riders[0].user, t);
    await prisma.rider.update({ where: { id: w.riders[0].rider.id }, data: { is_online: false } });
    await placeOrder(api, w);
    assert.ok(!calls.flatMap((c) => c.tokens).includes(t));
  });

  it("a stale token is deactivated, the rest still get the message, nothing throws", async () => {
    const stale = fcmToken();
    const good = fcmToken();
    const calls = fakeMessaging({ dead: [stale] });
    await register(w.riders[0].user, stale);
    await register(w.riders[1].user, good);
    const res = await api("POST", "/orders/quick-call", {
      token: w.vendorToken,
      body: { items: [{ product_id: w.products.biryani.id, quantity: 2 }] },
    });
    assert.equal(res.status, 201);
    assert.equal((await prisma.deviceRegistration.findUnique({ where: { fcm_token: stale } })).is_active, false);
    assert.equal((await prisma.deviceRegistration.findUnique({ where: { fcm_token: good } })).is_active, true);

    calls.length = 0;
    await placeOrder(api, w);
    const sent = calls.flatMap((c) => c.tokens);
    assert.ok(!sent.includes(stale), "stale token must not be retried");
    assert.ok(sent.includes(good));
  });

  it("a milestone bonus pushes the rider with dropputt://rider/earnings", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { daily_milestone_target: 1, daily_milestone_bonus: 50 } });
    const token = fcmToken();
    await register(w.riders[0].user, token);
    const calls = fakeMessaging();
    const order = await readyToDeliver(api, w);
    calls.length = 0;
    await deliver(api, w.riders[0], order.id);
    // The push is sent after the response, so wait for it.
    const milestone = await waitFor(() => calls.find((c) => c.data.deep_link === "dropputt://rider/earnings"));
    assert.ok(milestone, JSON.stringify(calls.map((c) => c.data)));
    assert.ok(milestone.tokens.includes(token));
  });

  it("a campaign reaches active customer devices only", async () => {
    const customer = await prisma.customer.create({ data: { franchise_id: w.franchise.id, phone: nextPhone() } });
    const active = fcmToken();
    const inactive = fcmToken();
    await prisma.deviceRegistration.create({ data: { customer_id: customer.id, fcm_token: active, platform: "android" } });
    await prisma.deviceRegistration.create({ data: { customer_id: customer.id, fcm_token: inactive, platform: "android", is_active: false } });
    await prisma.pushCampaign.create({ data: { franchise_id: w.franchise.id, title: "☕ 4 PM Snacks Ready!", body: "Chayakadi time" } });
    const calls = fakeMessaging();
    await runCampaigns();
    const sent = calls.flatMap((c) => c.tokens);
    assert.deepEqual(sent, [active]);
    assert.equal(calls[0].data.deep_link, "dropputt://marketplace?slot=EVENING_SNACKS_3_TO_6");
  });
});

describe("offline GPS flush (§50.1)", () => {
  async function watch(order) {
    const customer = connect(server.url, { auth: { location_token: order.token }, transports: ["websocket"] });
    const seen = [];
    customer.on("live_bike_position", (e) => seen.push(e));
    await new Promise((resolve, reject) => {
      customer.on("connect", resolve);
      customer.on("connect_error", reject);
    });
    return { seen, close: () => customer.close() };
  }
  const batch = (order_id, n = 10, base = Date.now()) => ({
    order_id,
    locations: Array.from({ length: n }, (_, i) => ({
      lat: 11 + i * 0.001,
      lng: 76,
      accuracy: 8,
      timestamp: base - (n - i) * 5000,
    })),
  });
  const send = (body, rider = w.riders[0]) => api("POST", "/riders/location-batch", { token: rider.token, body });
  const settle = () => new Promise((r) => setTimeout(r, 300));

  it("10 queued points → all accepted, 10 positions emitted, in order", async () => {
    const order = await readyToDeliver(api, w);
    const room = await watch(order);
    try {
      const body = batch(order.id);
      body.locations.reverse(); // arrives shuffled; the server orders them
      const res = await send(body);
      assert.deepEqual(res.body.data, { accepted: 10, duplicates: 0, rejected: 0 });
      await settle();
      assert.equal(room.seen.length, 10);
      const times = room.seen.map((e) => e.timestamp);
      assert.deepEqual(times, [...times].sort((a, b) => a - b));
      assert.ok(!JSON.stringify(room.seen).includes("rider_id"), "no rider identity for customers");
    } finally {
      room.close();
    }
  });

  it("the same batch twice (network retry) → each position delivered once", async () => {
    const order = await readyToDeliver(api, w);
    const room = await watch(order);
    try {
      const body = batch(order.id);
      await send(body);
      const retry = await send(body);
      assert.deepEqual(retry.body.data, { accepted: 0, duplicates: 10, rejected: 0 });
      await settle();
      assert.equal(room.seen.length, 10);
    } finally {
      room.close();
    }
  });

  it("the stored 'current position' never moves backwards", async () => {
    const order = await readyToDeliver(api, w);
    const now = Date.now();
    await send({ order_id: order.id, locations: [{ lat: 11.5, lng: 76.5, timestamp: now - 1000 }] });
    await send({ order_id: order.id, locations: [{ lat: 11.1, lng: 76.1, timestamp: now - 60_000 }] });
    const rider = await prisma.rider.findUnique({ where: { id: w.riders[0].rider.id } });
    assert.equal(rider.current_lat.toFixed(1), "11.5");
  });

  it("another rider's order, a finished order, and old or future points are not accepted", async () => {
    const order = await readyToDeliver(api, w);
    assert.equal((await send(batch(order.id), w.riders[1])).status, 404);
    assert.equal((await send(batch(999999))).status, 404);
    const stale = await send(batch(order.id, 3, Date.now() - 3 * 60 * 60 * 1000));
    assert.equal(stale.status, 404); // all rejected → nothing stored
    const future = await send({ order_id: order.id, locations: [{ lat: 11, lng: 76, timestamp: Date.now() + 10 * 60 * 1000 }] });
    assert.equal(future.status, 404);
    await deliver(api, w.riders[0], order.id);
    assert.equal((await send(batch(order.id))).status, 404);
  });

  it("validates the body and caps a batch at 500 points", async () => {
    const order = await readyToDeliver(api, w);
    assert.equal((await send({ order_id: order.id, locations: [] })).status, 422);
    assert.equal((await send({ order_id: order.id, locations: [{ lat: 200, lng: 0, timestamp: Date.now() }] })).status, 422);
    assert.equal((await send(batch(order.id, 501))).status, 422);
  });
});

describe("rider active orders (§52.2)", () => {
  it("returns only this rider's in-progress orders, scoped to the franchise", async () => {
    const mine = await readyToDeliver(api, w, w.riders[0]);
    const theirs = await readyToDeliver(api, w, w.riders[1]);
    const res = await api("GET", "/riders/me/active-orders", { token: w.riders[0].token });
    assert.equal(res.status, 200);
    const ids = res.body.data.orders.map((o) => o.id);
    assert.deepEqual(ids, [mine.id]);
    assert.ok(!ids.includes(theirs.id));
    const o = res.body.data.orders[0];
    for (const key of ["order_number", "order_status", "pickup_address", "amount_to_collect", "payment_method", "customer_phone", "location_token"]) {
      assert.ok(key in o, key);
    }
    assert.equal(o.order_status, "PICKED_UP");
  });

  it("is rider-only and works under both /rider and /riders", async () => {
    assert.equal((await api("GET", "/rider/me/active-orders", { token: w.riders[0].token })).status, 200);
    assert.equal((await api("GET", "/riders/me/active-orders", { token: w.vendorToken })).status, 403);
  });
});

describe("cursor pagination (§48)", () => {
  beforeEach(async () => {
    for (let i = 0; i < 7; i += 1) await placeOrder(api, w);
  });
  const list = (qs = "") => api("GET", `/orders${qs}`, { token: w.adminToken });

  it("limit=5 → 5 orders and has_more; the cursor returns the rest", async () => {
    const page1 = await list("?limit=5");
    assert.equal(page1.body.data.orders.length, 5);
    assert.equal(page1.body.meta.pagination.has_more, true);
    const page2 = await list(`?limit=5&cursor=${encodeURIComponent(page1.body.meta.pagination.next_cursor)}`);
    assert.equal(page2.body.data.orders.length, 2);
    assert.equal(page2.body.meta.pagination.has_more, false);
    assert.equal(page2.body.meta.pagination.next_cursor, null);
    const ids = [...page1.body.data.orders, ...page2.body.data.orders].map((o) => o.id);
    assert.equal(new Set(ids).size, 7);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  });

  it("limit=200 is capped at 100", async () => {
    const res = await list("?limit=200");
    assert.equal(res.body.meta.pagination.limit, 100);
    assert.ok(res.body.data.orders.length <= 100);
  });

  it("a bad cursor or status is a validation error", async () => {
    assert.equal((await list("?cursor=not-a-cursor")).status, 422);
    assert.equal((await list("?status=NOPE")).status, 422);
  });

  it("riders and vendors only see their own orders", async () => {
    assert.equal((await api("GET", "/orders", { token: w.riders[0].token })).body.data.orders.length, 0);
    assert.equal((await api("GET", "/orders", { token: w.vendorToken })).body.data.orders.length, 7);
  });
});

describe("app version gate (§54.2)", () => {
  it("blocks native apps below the minimum, never web clients", async () => {
    env.minAppVersion.android = "1.1.0";
    env.appStoreUrl.android = "https://play.google.com/store/apps/details?id=in.techkerala.dropputt";
    try {
      const old = await api("GET", "/marketplace/zones", { headers: { "X-App-Version": "1.0.9" } });
      assert.equal(old.status, 403);
      assert.equal(old.body.error.code, "APP_UPDATE_REQUIRED");
      assert.equal(old.body.error.details[0].min_version, "1.1.0");
      assert.match(old.body.error.details[0].store_url, /play\.google\.com/);

      assert.equal((await api("GET", "/marketplace/zones", { headers: { "X-App-Version": "1.1.0" } })).status, 200);
      assert.equal((await api("GET", "/marketplace/zones", { headers: { "X-App-Version": "2.0.0" } })).status, 200);
      assert.equal((await api("GET", "/marketplace/zones", {})).status, 200); // web: no header
      assert.equal((await api("GET", "/marketplace/zones", { headers: { "X-App-Version": "banana" } })).status, 200);
      // iOS has its own threshold (unset here)
      assert.equal((await api("GET", "/marketplace/zones", { headers: { "X-App-Version": "0.1.0", "X-App-Platform": "ios" } })).status, 200);
    } finally {
      env.minAppVersion.android = "";
      env.appStoreUrl.android = "";
    }
  });
});
