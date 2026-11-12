import "../helpers/env.js";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { io as connect } from "socket.io-client";
import { after, before, beforeEach, describe, it } from "node:test";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld, tokenFor } from "../helpers/fixtures.js";
import { readyToDeliver, uuid } from "../helpers/flow.js";

let server, raw, api, w, other;
before(async () => {
  server = await startServer();
  raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  other = await makeOtherWorld();
});

const open = (auth) =>
  new Promise((resolve) => {
    const socket = connect(server.url, { auth, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve({ ok: true, socket }));
    socket.on("connect_error", (error) => {
      socket.close();
      resolve({ ok: false, message: error.message });
    });
  });
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

describe("socket authentication (§37.12)", () => {
  it("refuses connections with no credentials", async () => {
    const r = await open({});
    assert.equal(r.ok, false);
    assert.equal(r.message, "UNAUTHENTICATED");
  });

  it("refuses garbage, wrongly signed and unknown tokens", async () => {
    for (const auth of [
      { token: "garbage" },
      { token: jwt.sign({ role: "RIDER" }, "x".repeat(40), { subject: "1" }) },
      { location_token: "x".repeat(32) },
      { location_token: "short" },
    ]) {
      assert.equal((await open(auth)).ok, false, JSON.stringify(auth));
    }
  });

  it("reports an expired token as TOKEN_EXPIRED so the client can refresh", async () => {
    const u = w.riders[0].user;
    const token = jwt.sign({ role: u.role, franchise_id: u.franchise_id }, process.env.JWT_SECRET, { subject: String(u.id), expiresIn: -5 });
    assert.equal((await open({ token })).message, "TOKEN_EXPIRED");
  });

  it("refuses a deactivated user", async () => {
    await prisma.user.update({ where: { id: w.riders[0].user.id }, data: { is_active: false } });
    assert.equal((await open({ token: w.riders[0].token })).ok, false);
  });

  it("accepts valid staff tokens and Magic Link tokens", async () => {
    const order = await readyToDeliver(api, w);
    for (const auth of [{ token: w.riders[0].token }, { token: w.adminToken }, { location_token: order.token }]) {
      const r = await open(auth);
      assert.equal(r.ok, true, JSON.stringify(auth));
      r.socket.close();
    }
  });

  it("only the Super Admin may watch a franchise they don't belong to", async () => {
    const asAdmin = await open({ token: w.adminToken, franchise_slug: "other" });
    // A franchise admin's own room is used; the slug hint must not grant access.
    const seen = [];
    if (asAdmin.ok) asAdmin.socket.on("fleet_rider_move", (e) => seen.push(e));
    const otherOrder = await readyToDeliver((m, p, o) => raw(m, p, { slug: "other", ...o }), other);
    const rider = await open({ token: other.riders[0].token });
    await rider.socket.emitWithAck("rider_location_move", { order_id: otherOrder.id, lat: 11, lng: 76, timestamp: Date.now() });
    await wait();
    assert.equal(seen.length, 0);
    asAdmin.socket?.close();
    rider.socket.close();
  });
});

describe("socket tenant and order isolation (§30)", () => {
  it("a rider's movement reaches only their own franchise admins and that order's tracker", async () => {
    const orderA = await readyToDeliver(api, w, w.riders[0]);
    const orderB = await readyToDeliver((m, p, o) => raw(m, p, { slug: "other", ...o }), other);
    const adminA = (await open({ token: w.adminToken })).socket;
    const adminB = (await open({ token: other.adminToken })).socket;
    const trackerA = (await open({ location_token: orderA.token })).socket;
    const trackerB = (await open({ location_token: orderB.token })).socket;
    const got = { adminA: [], adminB: [], trackerA: [], trackerB: [] };
    adminA.on("fleet_rider_move", (e) => got.adminA.push(e));
    adminB.on("fleet_rider_move", (e) => got.adminB.push(e));
    trackerA.on("live_bike_position", (e) => got.trackerA.push(e));
    trackerB.on("live_bike_position", (e) => got.trackerB.push(e));
    const rider = (await open({ token: w.riders[0].token })).socket;
    try {
      const ack = await rider.emitWithAck("rider_location_move", { order_id: orderA.id, lat: 11.1, lng: 76.1, timestamp: Date.now() });
      assert.equal(ack.ok, true);
      await wait();
      assert.equal(got.adminA.length, 1);
      assert.equal(got.trackerA.length, 1);
      assert.equal(got.adminB.length, 0, "other franchise's admin must hear nothing");
      assert.equal(got.trackerB.length, 0, "another order's tracker must hear nothing");
      assert.equal(got.trackerA[0].order_id, orderA.id);
    } finally {
      for (const s of [adminA, adminB, trackerA, trackerB, rider]) s.close();
    }
  });

  it("a rider cannot publish positions for an order that is not theirs", async () => {
    const mine = await readyToDeliver(api, w, w.riders[0]);
    const theirs = await readyToDeliver(api, w, w.riders[1]);
    const tracker = (await open({ location_token: theirs.token })).socket;
    const seen = [];
    tracker.on("live_bike_position", (e) => seen.push(e));
    const rider = (await open({ token: w.riders[0].token })).socket;
    try {
      const ack = await rider.emitWithAck("rider_location_move", { order_id: theirs.id, lat: 1, lng: 1, timestamp: Date.now() });
      assert.equal(ack.ok, false);
      await wait();
      assert.equal(seen.length, 0);
      void mine;
    } finally {
      tracker.close();
      rider.close();
    }
  });

  it("malformed location events are rejected, not crashing the server", async () => {
    const rider = (await open({ token: w.riders[0].token })).socket;
    try {
      for (const bad of [null, "x", {}, { order_id: "a" }, { order_id: 1, lat: 999, lng: 0, timestamp: 1 }]) {
        const ack = await rider.emitWithAck("rider_location_move", bad);
        assert.equal(ack.ok, false);
      }
      assert.equal((await raw("GET", "/marketplace/zones", { slug: "tf" })).status, 200);
    } finally {
      rider.close();
    }
  });
});

describe("what the API never reveals", () => {
  it("raw KYC details never appear in rider, admin or public responses", async () => {
    await prisma.rider.update({
      where: { id: w.riders[0].rider.id },
      data: { kyc_document_url: "https://private.example/kyc-aadhaar-9999.jpg", license_number: "DL-SECRET-123" },
    });
    const order = await readyToDeliver(api, w, w.riders[0]);
    const responses = [
      await api("GET", "/rider/me", { token: w.riders[0].token }),
      await api("GET", "/rider/earnings", { token: w.riders[0].token }),
      await api("GET", "/orders/active", { token: w.riders[0].token }),
      await api("GET", "/orders", { token: w.adminToken }),
      await api("GET", "/orders/active", { token: w.vendorToken }),
      await api("GET", "/admin/overview", { token: w.adminToken }),
      await api("GET", "/admin/riders", { token: w.adminToken }),
      await api("GET", `/public/drop/${order.token}`, {}),
      await api("GET", `/public/drop/${order.token}/status`, {}),
    ];
    for (const res of responses) {
      const text = JSON.stringify(res.body);
      assert.ok(!text.includes("kyc"), `${res.status} leaked kyc`);
      assert.ok(!text.includes("DL-SECRET-123"), "leaked licence number");
    }
  });

  it("the customer page and vendor board never expose rider earnings or phone", async () => {
    const order = await readyToDeliver(api, w, w.riders[0]);
    const page = JSON.stringify((await api("GET", `/public/drop/${order.token}`, {})).body);
    assert.ok(!page.includes(w.riders[0].user.phone));
    for (const field of ["rider_earning", "franchise_profit", "super_admin_profit", "vendor_commission", "royalty"]) {
      assert.ok(!page.includes(field), `public page exposes ${field}`);
    }
    const board = JSON.stringify((await api("GET", "/orders/active", { token: w.vendorToken })).body);
    assert.ok(!board.includes('"rider_earning"'));
    assert.ok(!board.includes(w.riders[0].user.phone));
  });

  it("internal errors never leak database details", async () => {
    const logs = [];
    const original = console.error;
    console.error = (line) => logs.push(line);
    const res = {
      locals: { request_id: "req-1" },
      headersSent: false,
      statusCode: 0,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      set() { return this; },
      setHeader() {},
    };
    try {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Invalid `prisma.order.findUnique()` invocation: relation "orders" does not exist',
        { code: "P2021", clientVersion: "5" }
      );
      errorHandler(prismaError, { originalUrl: "/api/v1/x?token=secret" }, res, () => {});
    } finally {
      console.error = original;
    }
    assert.equal(res.statusCode, 500);
    const text = JSON.stringify(res.body);
    assert.ok(text.includes("INTERNAL_ERROR"));
    assert.ok(!/prisma|relation|orders|P2021/i.test(text), text);
    assert.ok(logs.length === 1, "the real error is logged server-side");
    assert.ok(!logs[0].includes("secret"), "query strings are not logged");
  });

  it("no X-Powered-By, and basic security headers are present", async () => {
    const res = await api("GET", "/marketplace/zones", {});
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
});

describe("input handling (§37.3)", () => {
  it("malformed or oversized JSON is a clean 422", async () => {
    const bad = await fetch(`${server.url}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal(bad.status, 422);
    const huge = await fetch(`${server.url}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: "x".repeat(200_000) }) });
    assert.equal(huge.status, 422);
  });

  it("wrong types and injection-looking strings are rejected without touching the database", async () => {
    const attempts = [
      api("GET", "/orders/customer-lookup?phone=' OR 1=1 --", { token: w.riders[0].token }),
      api("POST", "/auth/login", { body: { phone: { $ne: null }, pin: ["1"] } }),
      api("POST", "/orders/quick-call", { token: w.vendorToken, body: { items: "DROP TABLE orders" } }),
      api("POST", "/orders/quick-call", { token: w.vendorToken, body: { items: [{ product_id: "1; DROP TABLE orders", quantity: 1 }] } }),
      api("GET", "/orders/abc/accept", { token: w.riders[0].token }),
      api("POST", "/orders/9999999999999999999/accept", { token: w.riders[0].token, body: {} }),
      api("POST", "/orders/2147483648/accept", { token: w.riders[0].token, body: {} }),
      api("GET", "/orders?cursor=" + Buffer.from(JSON.stringify({ id: 99999999999 })).toString("base64"), { token: w.adminToken }),
      api("POST", "/marketplace/checkout", { body: { vendor_id: 99999999999, zone_id: 1, customer_phone: "9876543210", drop_address: "abc", items: [{ product_id: 1, quantity: 1 }] } }),
      api("POST", "/riders/location-batch", { token: w.riders[0].token, body: { order_id: 99999999999, locations: [{ lat: 1, lng: 1, timestamp: Date.now() }] } }),
    ];
    for (const res of await Promise.all(attempts)) {
      assert.ok([404, 422].includes(res.status), `status ${res.status}`);
    }
    assert.ok((await prisma.order.count()) === 0);
  });

  it("Magic Link writes are rate limited per link", async () => {
    const order = await readyToDeliver(api, w);
    let last;
    for (let i = 0; i < 22; i += 1) {
      last = await api("POST", `/public/drop/${order.token}/tip`, { body: { tip: 15, client_action_id: uuid() } });
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, "RATE_LIMITED");
    // another link is unaffected
    const second = await readyToDeliver(api, w, w.riders[1]);
    const ok = await api("POST", `/public/drop/${second.token}/tip`, { body: { tip: 15, client_action_id: uuid() } });
    assert.equal(ok.status, 422);
  });

  it("malformed Magic Link tokens are a 404", async () => {
    for (const token of ["short", "a".repeat(200), "bad token with spaces!!", "../../etc/passwd"]) {
      const res = await api("GET", `/public/drop/${encodeURIComponent(token)}`, {});
      assert.equal(res.status, 404, token);
    }
  });
});

describe("role guards", () => {
  async function superAdmin() {
    const user = await prisma.user.create({ data: { franchise_id: null, role: "SUPER_ADMIN", name: "Root", phone: "9888888888", pin_hash: "x" } });
    return tokenFor(user);
  }
  const call = (method, path, token, body) => api(method, path, { token, body });

  it("endpoints are closed to roles that should not reach them", async () => {
    const matrix = [
      ["GET", "/admin/overview", w.riders[0].token],
      ["GET", "/admin/overview", w.vendorToken],
      ["POST", "/admin/riders/1/cash-settlement", w.vendorToken],
      ["PATCH", "/admin/franchise/settings", w.riders[0].token],
      ["GET", "/super/franchises", w.adminToken],
      ["POST", "/super/franchises", w.adminToken],
      ["POST", "/admin/franchise/wallet/top-up", w.adminToken], // only the Super Admin loads the wallet
      ["PATCH", "/rider/me/online", w.vendorToken],
      ["GET", "/vendor/me", w.riders[0].token],
      ["PATCH", "/vendor/shop", w.adminToken],
      ["POST", "/orders/quick-call", w.riders[0].token],
    ];
    for (const [method, path, token] of matrix) {
      const res = await call(method, path, token, method === "GET" ? undefined : {});
      assert.equal(res.status, 403, `${method} ${path} → ${res.status}`);
    }
  });

  it("the Super Admin can manage franchises; slugs are protected", async () => {
    const token = await superAdmin();
    assert.equal((await call("GET", "/super/franchises", token)).status, 200);
    const admin = { name: "Boss", phone: "9777777777", pin: "123456" };
    const created = await call("POST", "/super/franchises", token, { name: "Edavannappara", slug: "edavannappara", admin });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const dup = await call("POST", "/super/franchises", token, { name: "Dup", slug: "edavannappara", admin: { ...admin, phone: "9777777778" } });
    assert.equal(dup.status, 409);
    for (const slug of ["admin", "www", "api", "Bad Slug!"]) {
      const res = await call("POST", "/super/franchises", token, { name: "X", slug, admin: { ...admin, phone: "9777777779" } });
      assert.equal(res.status, 422, slug);
    }
    const pinHash = (await prisma.user.findFirst({ where: { phone: "9777777777" } })).pin_hash;
    assert.match(pinHash, /^\$argon2/);
  });

  it("an inactive franchise stops all its traffic", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { is_active: false } });
    const res = await api("GET", "/rider/me", { token: w.riders[0].token });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FRANCHISE_INACTIVE");
    const feed = await api("GET", "/marketplace/feed", {});
    assert.equal(feed.status, 403);
  });

  it("cash settlement cannot be replayed with the same Idempotency-Key", async () => {
    await prisma.rider.update({ where: { id: w.riders[0].rider.id }, data: { cash_in_hand: 500 } });
    const key = uuid();
    const settle = () =>
      api("POST", `/admin/riders/${w.riders[0].rider.id}/cash-settlement`, {
        token: w.adminToken,
        headers: { "Idempotency-Key": key },
        body: { amount: "200" },
      });
    const first = await settle();
    const second = await settle();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(second.status, 200);
    const rider = await prisma.rider.findUnique({ where: { id: w.riders[0].rider.id } });
    assert.equal(rider.cash_in_hand.toFixed(2), "300.00"); // reduced once, not twice
  });

  it("cash settlement cannot exceed the rider's cash in hand or cross franchises", async () => {
    await prisma.rider.update({ where: { id: w.riders[0].rider.id }, data: { cash_in_hand: 100 } });
    const over = await api("POST", `/admin/riders/${w.riders[0].rider.id}/cash-settlement`, { token: w.adminToken, body: { amount: "500" } });
    assert.ok(over.status >= 400 && over.status < 500, `status ${over.status}`);
    const cross = await raw("POST", `/admin/riders/${other.riders[0].rider.id}/cash-settlement`, { token: w.adminToken, slug: "tf", body: { amount: "10" } });
    assert.ok([403, 404].includes(cross.status), `status ${cross.status}`);
    assert.equal((await prisma.rider.findUnique({ where: { id: other.riders[0].rider.id } })).cash_in_hand.toFixed(2), "0.00");
  });
});

describe("HTTPS in production (§37.11)", () => {
  it("plain HTTP is refused, TLS passes, /health stays open for probes", async () => {
    const { requireHttps } = await import("../../src/middleware/requireHttps.js");
    const run = (req) => {
      const out = { next: false, status: null, code: null };
      const res = {
        locals: { request_id: "r" },
        status(c) { out.status = c; return this; },
        json(b) { out.code = b.error?.code; return this; },
        set() { return this; },
        setHeader() {},
      };
      requireHttps(req, res, () => { out.next = true; });
      return out;
    };
    assert.deepEqual(run({ secure: false, path: "/api/v1/orders" }), { next: false, status: 400, code: "HTTPS_REQUIRED" });
    assert.equal(run({ secure: true, path: "/api/v1/orders" }).next, true);
    assert.equal(run({ secure: false, path: "/health" }).next, true);
  });

  it("is on by default in production and can be switched off explicitly", async () => {
    const { execFileSync } = await import("node:child_process");
    const probe = (extra) =>
      execFileSync(process.execPath, ["-e", 'import("./src/config/env.js").then(m=>console.log(m.env.requireHttps))'], {
        cwd: new URL("../..", import.meta.url),
        env: { ...process.env, NODE_ENV: "production", JWT_SECRET: "p".repeat(40), TRUST_PROXY: "1", ...extra },
      }).toString().trim().split("\n").pop();
    assert.equal(probe({}), "true");
    assert.equal(probe({ REQUIRE_HTTPS: "false" }), "false");
  });
});
