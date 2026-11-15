import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld, tokenFor } from "../helpers/fixtures.js";
import { accept, deliver, placeOrder, readyToDeliver } from "../helpers/flow.js";

let server, raw, api, w, other, superToken;
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
  const root = await prisma.user.create({
    data: { franchise_id: null, role: "SUPER_ADMIN", name: "Root", phone: "9888888888", pin_hash: "x" },
  });
  superToken = tokenFor(root);
});

const rider = () => w.riders[0];
const setLimit = (token, body, id = rider().rider.id, slug = "tf") =>
  raw("PATCH", `/admin/riders/${id}/cash-limit`, { token, slug, body });
const patchVendor = (token, body, id = w.vendor.id, slug = "tf") =>
  raw("PATCH", `/admin/vendors/${id}`, { token, slug, body });

describe("rider cash limit (admin + super admin)", () => {
  it("both roles can change a rider's limit", async () => {
    const a = await setLimit(w.adminToken, { max_cash_limit: "2500" });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.data.max_cash_limit, "2500.00");
    const b = await setLimit(superToken, { max_cash_limit: "800" });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    const row = await prisma.rider.findUnique({ where: { id: rider().rider.id } });
    assert.equal(row.max_cash_limit.toFixed(2), "800.00");
  });

  it("raising the limit unblocks a rider, lowering it blocks one", async () => {
    const held = Number((await (async () => {
      const o = await readyToDeliver(api, w);
      await deliver(api, rider(), o.id);
      return prisma.rider.findUnique({ where: { id: rider().rider.id } });
    })()).cash_in_hand);
    // lower below the cash in hand → blocked
    const low = await setLimit(w.adminToken, { max_cash_limit: String(held) });
    assert.equal(low.body.data.is_cash_locked, true);
    const next = await placeOrder(api, w);
    const blocked = await accept(api, rider(), next.id);
    assert.equal(blocked.status, 422);
    // raise → unblocked
    const high = await setLimit(w.adminToken, { max_cash_limit: String(held + 1000) });
    assert.equal(high.body.data.is_cash_locked, false);
    assert.equal((await accept(api, rider(), next.id)).status, 200);
  });

  it("validates the amount and the caller", async () => {
    for (const bad of ["0", "-5", "100001", "abc"]) {
      assert.equal((await setLimit(w.adminToken, { max_cash_limit: bad })).status, 422, bad);
    }
    assert.equal((await setLimit(w.vendorToken, { max_cash_limit: "2000" })).status, 403);
    assert.equal((await setLimit(rider().token, { max_cash_limit: "2000" })).status, 403);
    const cross = await setLimit(w.adminToken, { max_cash_limit: "2000" }, other.riders[0].rider.id);
    assert.ok([403, 404].includes(cross.status), `status ${cross.status}`);
    assert.equal((await prisma.rider.findUnique({ where: { id: other.riders[0].rider.id } })).max_cash_limit.toFixed(2), "1500.00");
  });
});

describe("hotel commission terms", () => {
  it("only the Super Admin changes the commission percentage", async () => {
    assert.equal((await patchVendor(w.adminToken, { commission_rate: 2 })).status, 403);
    const ok = await patchVendor(superToken, { commission_rate: 1.5 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.vendor.commission_rate, "1.50");
    assert.equal((await patchVendor(superToken, { commission_rate: 101 })).status, 422);
    assert.equal((await patchVendor(superToken, { commission_rate: -1 })).status, 422);
  });

  it("the franchise admin sets, extends and ends the trial", async () => {
    const set = await patchVendor(w.adminToken, { commission_free_until: "2030-01-31" });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.data.vendor.trial_active, true);
    const row = await prisma.vendor.findUnique({ where: { id: w.vendor.id } });
    assert.equal(row.commission_free_until.toISOString(), "2030-01-31T18:30:00.000Z"); // end of that IST day
    const ended = await patchVendor(w.adminToken, { commission_free_until: "2020-01-01" });
    assert.equal(ended.body.data.vendor.trial_active, false);
    const cleared = await patchVendor(w.adminToken, { commission_free_until: null });
    assert.equal(cleared.body.data.vendor.commission_free_until, null);
    assert.equal((await patchVendor(w.adminToken, { commission_free_until: "31-01-2030" })).status, 422);
    assert.equal((await patchVendor(w.adminToken, {})).status, 422);
  });

  it("roles and tenants are enforced; the list and the vendor app show the trial", async () => {
    assert.equal((await patchVendor(w.vendorToken, { commission_free_until: null })).status, 403);
    const cross = await patchVendor(w.adminToken, { commission_free_until: null }, other.vendor.id);
    assert.ok([403, 404].includes(cross.status), `status ${cross.status}`);
    const list = await api("GET", "/admin/vendors", { token: w.adminToken });
    assert.equal(list.body.data.vendors[0].trial_active, true);
    assert.equal(list.body.data.vendors[0].commission_rate, "10.00");
    const me = await api("GET", "/vendor/me", { token: w.vendorToken });
    assert.equal(me.body.data.shop.trial_active, true);
  });
});

describe("franchise default commission (Super Admin)", () => {
  const superPatch = (token, body, id = w.franchise.id) => raw("PATCH", `/super/franchises/${id}`, { token, body });

  it("a new franchise and hotel default to 10%", async () => {
    assert.equal(Number((await prisma.franchise.findUnique({ where: { id: w.franchise.id } })).default_commission_rate), 10);
    assert.equal(Number((await prisma.vendor.create({
      data: { franchise_id: w.franchise.id, user_id: w.adminUser?.id ?? (await prisma.user.create({ data: { franchise_id: w.franchise.id, role: "VENDOR", name: "V2", phone: "9111111111", pin_hash: "x" } })).id, shop_name: "Second", address: "x", lat: "11", lng: "76" },
    })).commission_rate), 10);
  });

  it("only the Super Admin sets it; it can also be applied to every hotel", async () => {
    assert.equal((await superPatch(w.adminToken, { default_commission_rate: 2 })).status, 403);
    const saved = await superPatch(superToken, { default_commission_rate: 4 });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.franchise.default_commission_rate, "4.00");
    assert.equal(saved.body.data.hotels_updated, 0);
    assert.equal(Number((await prisma.vendor.findUnique({ where: { id: w.vendor.id } })).commission_rate), 10);
    const applied = await superPatch(superToken, { default_commission_rate: 3, apply_to_hotels: true });
    assert.equal(applied.body.data.hotels_updated, 1);
    assert.equal(Number((await prisma.vendor.findUnique({ where: { id: w.vendor.id } })).commission_rate), 3);
    assert.equal(Number((await prisma.vendor.findUnique({ where: { id: other.vendor.id } })).commission_rate), 10); // other franchise untouched
  });

  it("validates the percentage and keeps suspend/activate working", async () => {
    assert.equal((await superPatch(superToken, { default_commission_rate: 101 })).status, 422);
    assert.equal((await superPatch(superToken, { default_commission_rate: -1 })).status, 422);
    assert.equal((await superPatch(superToken, { apply_to_hotels: true })).status, 422);
    assert.equal((await superPatch(superToken, {})).status, 422);
    assert.equal((await superPatch(superToken, { is_active: false })).status, 200);
  });
});

