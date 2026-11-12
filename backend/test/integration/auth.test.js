import "../helpers/env.js";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { PIN, makeWorld } from "../helpers/fixtures.js";

let server, api, w, phone;
const login = (over = {}) => api("POST", "/auth/login", { slug: "tf", body: { phone, pin: PIN, ...over } });

before(async () => {
  server = await startServer();
  api = client(server.url);
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  phone = w.riders[0].user.phone;
});

describe("auth & token lifecycle (§58)", () => {
  it("valid PIN + slug → access and refresh tokens", async () => {
    const res = await login();
    assert.equal(res.status, 200);
    assert.ok(res.body.data.access_token);
    assert.ok(res.body.data.refresh_token);
    assert.equal(res.body.data.access_token_expires_in, 900);
    assert.equal(res.body.data.user.role, "RIDER");
  });

  it("invalid PIN → 401 UNAUTHENTICATED", async () => {
    const res = await login({ pin: "0000" });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHENTICATED");
  });

  it("unknown phone costs the same answer as a wrong PIN", async () => {
    const res = await login({ phone: "9111111111" });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, (await login({ pin: "0000" })).body.error.message);
  });

  it("unknown or inactive franchise → 403 FRANCHISE_INACTIVE", async () => {
    const res = await api("POST", "/auth/login", { slug: "nope", body: { phone, pin: PIN } });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FRANCHISE_INACTIVE");
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { is_active: false } });
    assert.equal((await login()).body.error.code, "FRANCHISE_INACTIVE");
  });

  it("PINs are stored hashed, never in plaintext", async () => {
    const user = await prisma.user.findUnique({ where: { id: w.riders[0].user.id } });
    assert.match(user.pin_hash, /^\$argon2/);
    assert.notEqual(user.pin_hash, PIN);
  });

  it("requests without Authorization → 401 UNAUTHENTICATED", async () => {
    const res = await api("GET", "/rider/me", { slug: "tf" });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHENTICATED");
  });

  it("a garbage or wrongly signed token → 401 UNAUTHENTICATED", async () => {
    for (const token of ["abc", jwt.sign({ role: "RIDER" }, "other-secret-other-secret-other-secret!!", { subject: "1" })]) {
      const res = await api("GET", "/rider/me", { token, slug: "tf" });
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, "UNAUTHENTICATED");
    }
  });

  it("expired access token → 401 TOKEN_EXPIRED (not UNAUTHENTICATED)", async () => {
    const user = w.riders[0].user;
    const expired = jwt.sign({ role: user.role, franchise_id: user.franchise_id }, process.env.JWT_SECRET, {
      subject: String(user.id),
      expiresIn: -10,
    });
    const res = await api("GET", "/rider/me", { token: expired, slug: "tf" });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "TOKEN_EXPIRED");
  });

  it("a deactivated user's token stops working immediately", async () => {
    await prisma.user.update({ where: { id: w.riders[0].user.id }, data: { is_active: false } });
    const res = await api("GET", "/rider/me", { token: w.riders[0].token, slug: "tf" });
    assert.equal(res.status, 401);
  });

  it("refresh rotates: new pair issued, old token invalidated", async () => {
    const first = (await login()).body.data;
    const next = await api("POST", "/auth/refresh", { body: { refresh_token: first.refresh_token } });
    assert.equal(next.status, 200);
    assert.notEqual(next.body.data.refresh_token, first.refresh_token);
    // the new access token works
    const me = await api("GET", "/rider/me", { token: next.body.data.access_token, slug: "tf" });
    assert.equal(me.status, 200);
  });

  it("reusing an old refresh token → 401 and the whole family is revoked", async () => {
    const first = (await login()).body.data;
    const next = (await api("POST", "/auth/refresh", { body: { refresh_token: first.refresh_token } })).body.data;
    const replay = await api("POST", "/auth/refresh", { body: { refresh_token: first.refresh_token } });
    assert.equal(replay.status, 401);
    // the legitimate new token was revoked too
    const after = await api("POST", "/auth/refresh", { body: { refresh_token: next.refresh_token } });
    assert.equal(after.status, 401);
    const live = await prisma.refreshToken.count({ where: { user_id: w.riders[0].user.id, revoked: false } });
    assert.equal(live, 0);
  });

  it("two concurrent refreshes cannot both win", async () => {
    const first = (await login()).body.data;
    const results = await Promise.all([
      api("POST", "/auth/refresh", { body: { refresh_token: first.refresh_token } }),
      api("POST", "/auth/refresh", { body: { refresh_token: first.refresh_token } }),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  it("refresh tokens are stored as SHA-256 hashes", async () => {
    const { refresh_token } = (await login()).body.data;
    const rows = await prisma.refreshToken.findMany();
    assert.ok(rows.every((r) => r.token_hash !== refresh_token && /^[0-9a-f]{64}$/.test(r.token_hash)));
  });

  it("logout revokes the refresh token", async () => {
    const pair = (await login()).body.data;
    const out = await api("POST", "/auth/logout", { token: pair.access_token, slug: "tf" });
    assert.equal(out.status, 200);
    const refresh = await api("POST", "/auth/refresh", { body: { refresh_token: pair.refresh_token } });
    assert.equal(refresh.status, 401);
  });

  it("wrong-PIN attempts are rate limited per account", async () => {
    let last;
    for (let i = 0; i < 12; i += 1) last = await login({ pin: "9999" });
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, "RATE_LIMITED");
  });
});

describe("response envelope (§47)", () => {
  it("success: success, data, meta.request_id, matching X-Request-ID header", async () => {
    const res = await api("GET", "/marketplace/zones", { slug: "tf" });
    assert.equal(res.body.success, true);
    assert.ok(res.body.data);
    assert.ok(res.body.meta.request_id);
    assert.equal(res.headers.get("x-request-id"), res.body.meta.request_id);
    assert.equal(res.body.meta.version, "v1");
  });

  it("error: success=false with code, message and request_id", async () => {
    const res = await api("GET", "/rider/me", { slug: "tf" });
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.code && res.body.error.message);
    assert.equal(res.headers.get("x-request-id"), res.body.meta.request_id);
  });

  it("unknown routes also use the envelope", async () => {
    const res = await api("GET", "/no/such/route", { slug: "tf" });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });
});
