import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { setMessagingClientForTests } from "../../src/utils/push.js";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld, nextPhone, pinAt } from "../helpers/fixtures.js";
import { accept, uuid, waitFor } from "../helpers/flow.js";

// SPEC §62: the shop is told about a new order (items + quantities), the rider
// of a shop that is not on the app is told the items instead.

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
});

const fcmToken = () => "fcm-token-" + uuid() + uuid();
function fakeMessaging() {
  const calls = [];
  setMessagingClientForTests({
    async sendEachForMulticast(message) {
      calls.push(message);
      return {
        successCount: message.tokens.length,
        failureCount: 0,
        responses: message.tokens.map(() => ({ success: true })),
      };
    },
  });
  return calls;
}
const device = (user, token) =>
  prisma.deviceRegistration.create({ data: { user_id: user.id, fcm_token: token, platform: "web" } });
const checkout = () =>
  api("POST", "/marketplace/checkout", {
    body: {
      vendor_id: w.vendor.id,
      ...pinAt(1),
      customer_phone: nextPhone(),
      drop_address: "Near the mosque",
      items: [
        { product_id: w.products.biryani.id, quantity: 2 },
        { product_id: w.products.meals.id, quantity: 1 },
      ],
    },
  });

describe("new order → shop and rider alerts (§62)", () => {
  it("pushes the shop the items and quantities", async () => {
    const calls = fakeMessaging();
    const shopToken = fcmToken();
    await device(w.vendorUser, shopToken);
    const res = await checkout();
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const call = calls.find((c) => c.tokens.includes(shopToken));
    assert.ok(call, "the shop device was pushed");
    assert.equal(call.notification.title, "🔔 New Order!");
    assert.match(call.notification.body, /2× /);
    assert.equal(call.data.type, "VENDOR_NEW_ORDER");
    assert.equal(call.data.web_path, "/vendor");
    assert.equal(call.android.notification.channelId, "order_alerts");
    assert.equal(call.webpush.notification.requireInteraction, true);
  });

  it("a shop that is not on the app is not pushed; its rider gets the item list", async () => {
    await prisma.vendor.update({ where: { id: w.vendor.id }, data: { app_enabled: false } });
    const calls = fakeMessaging();
    const shopToken = fcmToken();
    const riderToken = fcmToken();
    await device(w.vendorUser, shopToken);
    await device(w.riders[0].user, riderToken);
    await checkout();
    const sent = calls.flatMap((c) => c.tokens);
    assert.ok(!sent.includes(shopToken));
    const riderCall = calls.find((c) => c.tokens.includes(riderToken));
    assert.match(riderCall.notification.body, /2× /);

    const open = await api("GET", "/orders/active", { token: w.riders[0].token });
    const request = open.body.data.open_requests[0];
    assert.equal(request.vendor_on_app, false);
    assert.deepEqual(request.items.map((i) => i.quantity).sort(), [1, 2]);
  });

  it("a shop on the app: the rider's request says so and does not pad the push with items", async () => {
    const calls = fakeMessaging();
    const riderToken = fcmToken();
    await device(w.riders[0].user, riderToken);
    await checkout();
    const open = await api("GET", "/orders/active", { token: w.riders[0].token });
    assert.equal(open.body.data.open_requests[0].vendor_on_app, true);
    const riderCall = calls.find((c) => c.tokens.includes(riderToken));
    assert.doesNotMatch(riderCall.notification.body, /×/);
  });

  it("accepting tells the shop which rider is coming", async () => {
    const calls = fakeMessaging();
    const shopToken = fcmToken();
    const res = await checkout();
    await device(w.vendorUser, shopToken);
    const order = await prisma.order.findFirst({ where: { order_number: res.body.data.order_number } });
    calls.length = 0;
    const done = await accept(api, w.riders[0], order.id);
    assert.equal(done.status, 200);
    await waitFor(() => calls.some((c) => c.tokens.includes(shopToken))); // the push is sent in the background
    const call = calls.find((c) => c.tokens.includes(shopToken));
    assert.equal(call.notification.title, "✅ Order Accepted");
    assert.match(call.notification.body, /is coming/);
  });

  it("only the franchise admin can mark a shop as not on the app", async () => {
    const rider = await api("PATCH", `/admin/vendors/${w.vendor.id}`, {
      token: w.riders[0].token,
      body: { app_enabled: false },
    });
    assert.equal(rider.status, 403);
    const admin = await api("PATCH", `/admin/vendors/${w.vendor.id}`, {
      token: w.adminToken,
      body: { app_enabled: false },
    });
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    assert.equal(admin.body.data.vendor.app_enabled, false);
  });

  it("sign-out deactivates only the caller's own device", async () => {
    const mine = fcmToken();
    const theirs = fcmToken();
    await device(w.vendorUser, mine);
    await device(w.riders[0].user, theirs);
    const res = await api("POST", "/device/unregister", { token: w.vendorToken, body: { fcm_token: theirs } });
    assert.equal(res.body.data.deactivated, 0);
    const own = await api("POST", "/device/unregister", { token: w.vendorToken, body: { fcm_token: mine } });
    assert.equal(own.body.data.deactivated, 1);
    assert.equal((await prisma.deviceRegistration.findUnique({ where: { fcm_token: theirs } })).is_active, true);
  });
});
