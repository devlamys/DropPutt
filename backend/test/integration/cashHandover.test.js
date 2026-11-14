import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld } from "../helpers/fixtures.js";
import { accept, deliver, placeOrder, readyToDeliver, uuid } from "../helpers/flow.js";

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

const rider = () => w.riders[0];
const cash = async () => (await prisma.rider.findUnique({ where: { id: rider().rider.id } })).cash_in_hand;
const payable = async () => (await prisma.vendor.findUnique({ where: { id: w.vendor.id } })).admin_payable_balance;

/** Delivers one COD order so the rider holds cash that belongs to the vendor. */
async function holdCash() {
  const order = await readyToDeliver(api, w);
  const res = await deliver(api, rider(), order.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return Number(await cash());
}

const owed = async () =>
  (await api("GET", "/rider/me/cash-owed", { token: rider().token })).body.data;

const riderPays = (amount, key = uuid()) =>
  api("POST", "/rider/me/cash-handover", {
    token: rider().token,
    headers: { "Idempotency-Key": key },
    body: { vendor_id: w.vendor.id, amount: String(amount) },
  });

const vendorActs = (id, action, token = w.vendorToken, slug = "tf") =>
  raw("POST", `/vendor/cash-handovers/${id}/${action}`, { token, slug, body: {} });

describe("rider → vendor cash handover", () => {
  it("rider reports, vendor confirms once: cash and vendor payable drop, block lifts", async () => {
    const held = await holdCash();
    assert.ok(held > 0);
    const before = Number(await payable());

    const view = await owed();
    assert.equal(view.vendors.length, 1);
    assert.equal(Number(view.vendors[0].owed), held);

    const created = await riderPays(held);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.handover.id;
    assert.equal(created.body.data.handover.status, "PENDING");
    assert.equal(Number(await cash()), held, "nothing moves until the vendor confirms");

    const pending = await raw("GET", "/vendor/cash-handovers?status=PENDING", { token: w.vendorToken, slug: "tf" });
    assert.equal(pending.body.data.items.length, 1);

    const [a, b] = await Promise.all([vendorActs(id, "confirm"), vendorActs(id, "confirm")]);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(Number(await cash()), 0, "reduced exactly once");
    assert.equal(Number(await payable()), before - held);
    assert.equal((await vendorActs(id, "reject")).status, 409, "a confirmed handover cannot be rejected");
  });

  it("a rider over the cash limit can accept orders again after confirmation", async () => {
    const held = await holdCash();
    await prisma.rider.update({ where: { id: rider().rider.id }, data: { max_cash_limit: held } });
    const next = await placeOrder(api, w);
    const blocked = await accept(api, rider(), next.id);
    assert.equal(blocked.status, 422);
    assert.equal(blocked.body.error.code, "CASH_LIMIT_EXCEEDED");

    const created = await riderPays(held);
    await vendorActs(created.body.data.handover.id, "confirm");
    assert.equal((await accept(api, rider(), next.id)).status, 200);
  });

  it("rejecting leaves cash and vendor payable untouched", async () => {
    const held = await holdCash();
    const before = Number(await payable());
    const created = await riderPays(held);
    const res = await vendorActs(created.body.data.handover.id, "reject");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.handover.status, "REJECTED");
    assert.equal(Number(await cash()), held);
    assert.equal(Number(await payable()), before);
  });

  it("cannot report more than is owed to that vendor, and pending counts against it", async () => {
    const held = await holdCash();
    assert.equal((await riderPays(held + 1)).status, 422);
    assert.equal((await riderPays(held)).status, 201);
    assert.equal((await riderPays(1)).status, 422, "the rest is already reported");
  });

  it("the same Idempotency-Key does not create two handovers", async () => {
    const held = await holdCash();
    const key = uuid();
    await riderPays(held, key);
    await riderPays(held, key);
    assert.equal(await prisma.riderCashHandover.count(), 1);
  });

  it("the vendor can record cash received directly", async () => {
    const held = await holdCash();
    const res = await raw("POST", "/vendor/cash-handovers", {
      token: w.vendorToken,
      slug: "tf",
      headers: { "Idempotency-Key": uuid() },
      body: { rider_id: rider().rider.id, amount: String(held) },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.handover.status, "CONFIRMED");
    assert.equal(Number(await cash()), 0);
  });

  it("other vendors, riders and franchises cannot touch the handover", async () => {
    const held = await holdCash();
    const created = await riderPays(held);
    const id = created.body.data.handover.id;

    const crossTenant = await vendorActs(id, "confirm", other.vendorToken, "other");
    assert.ok([403, 404].includes(crossTenant.status), `status ${crossTenant.status}`);
    assert.equal((await vendorActs(id, "confirm", rider().token)).status, 403);
    assert.equal((await prisma.riderCashHandover.findUnique({ where: { id } })).status, "PENDING");
  });

  it("the admin can resolve a handover the vendor never answered", async () => {
    const held = await holdCash();
    const created = await riderPays(held);
    const res = await api("POST", `/admin/cash-handovers/${created.body.data.handover.id}/confirm`, {
      token: w.adminToken,
      body: {},
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Number(await cash()), 0);
  });

  it("direct admin settlement still works and leaves a record", async () => {
    const held = await holdCash();
    const res = await api("POST", `/admin/riders/${rider().rider.id}/cash-settlement`, {
      token: w.adminToken,
      headers: { "Idempotency-Key": uuid() },
      body: { amount: String(held) },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(Number(await cash()), 0);
    const row = await prisma.riderCashHandover.findFirst();
    assert.equal(row.initiated_by, "ADMIN");
    assert.equal(row.status, "CONFIRMED");
  });
});
