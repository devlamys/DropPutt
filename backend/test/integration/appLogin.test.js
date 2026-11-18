import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { PIN, makeWorld } from "../helpers/fixtures.js";

let server, api, w;
const login = (user, app, pin = PIN) =>
  api("POST", "/auth/login", { slug: "tf", body: { phone: user.phone, pin, ...(app ? { app } : {}) } });

before(async () => {
  server = await startServer();
  api = client(server.url);
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});

const DAY_MS = 86_400_000;
const daysLeft = (res) => Math.round(res.body.data.refresh_token_expires_in / 86400);

describe("each app signs in only its own role", () => {
  it("vendor app: vendors in, riders and admins refused", async () => {
    assert.equal((await login(w.vendorUser, "vendor")).status, 200);
    const rider = await login(w.riders[0].user, "vendor");
    assert.equal(rider.status, 403);
    assert.equal(rider.body.error.code, "WRONG_APP");
    assert.match(rider.body.error.message, /Vendor app.*Rider app/);
    assert.equal((await login(w.admin, "vendor")).status, 403);
  });

  it("rider app: riders in, vendors and admins refused", async () => {
    assert.equal((await login(w.riders[0].user, "rider")).status, 200);
    assert.equal((await login(w.vendorUser, "rider")).status, 403);
    assert.equal((await login(w.admin, "rider")).status, 403);
  });

  it("admin app: franchise admins in, others refused", async () => {
    assert.equal((await login(w.admin, "admin")).status, 200);
    assert.equal((await login(w.vendorUser, "admin")).status, 403);
    assert.equal((await login(w.riders[0].user, "admin")).status, 403);
  });

  it("a wrong PIN is refused the same way whichever app asks, so no account type leaks", async () => {
    const res = await login(w.riders[0].user, "vendor", "0000");
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHENTICATED");
  });

  it("no app named (plain web login) still signs in any role; unknown app names are refused", async () => {
    assert.equal((await login(w.vendorUser)).status, 200);
    assert.equal((await login(w.riders[0].user)).status, 200);
    assert.equal((await login(w.vendorUser, "customer")).status, 422);
  });
});

describe("vendor and rider apps stay signed in", () => {
  it("their refresh token lasts 180 days, the plain web login 30", async () => {
    assert.equal(daysLeft(await login(w.vendorUser, "vendor")), 180);
    assert.equal(daysLeft(await login(w.riders[0].user, "rider")), 180);
    assert.equal(daysLeft(await login(w.admin, "admin")), 30);
    assert.equal(daysLeft(await login(w.vendorUser)), 30);
  });

  it("rotating the token keeps the app and its long life", async () => {
    const first = await login(w.vendorUser, "vendor");
    const next = await api("POST", "/auth/refresh", { slug: "tf", body: { refresh_token: first.body.data.refresh_token } });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.equal(daysLeft(next), 180);
    const row = await prisma.refreshToken.findFirst({ where: { revoked: false, user_id: w.vendorUser.id } });
    assert.equal(row.app, "vendor");
    assert.ok(row.expires_at.getTime() - Date.now() > 179 * DAY_MS);
  });
});
