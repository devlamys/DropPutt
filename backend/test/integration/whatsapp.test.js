import "../helpers/env.js";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld, nextPhone, pinAt } from "../helpers/fixtures.js";
import { accept, deliver, pickup, placeOrder, waitFor } from "../helpers/flow.js";
import { setWhatsappClientForTests } from "../../src/services/whatsapp/client.js";

let server, api, w;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  await prisma.franchise.update({
    where: { id: w.franchise.id },
    data: { whatsapp_phone_number_id: "1000200030", whatsapp_enabled: true },
  });
});
afterEach(() => setWhatsappClientForTests(undefined));

// ── helpers ──────────────────────────────────────────────────────────────────
const chat = async (from, payload) => {
  const res = await api("POST", "/whatsapp/dev/simulate", { body: { from, franchise_slug: "tf", ...payload } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.replies;
};
const options = (replies) =>
  replies.flatMap((r) => [...(r.rows ?? []).map((x) => ({ ...x, kind: "list" })), ...(r.buttons ?? []).map((x) => ({ ...x, kind: "button" }))]);
const tap = (replies, title) => {
  const option = options(replies).find((o) => o.title.includes(title) || o.id === title);
  assert.ok(option, `no option "${title}" in ${JSON.stringify(options(replies).map((o) => o.title))}`);
  return option.kind === "list" ? { list_id: option.id } : { button_id: option.id };
};
const bodies = (replies) => replies.map((r) => r.body).join("\n");

/** Walks hi -> shop -> item -> qty -> checkout; returns the replies at the address step. */
async function toAddress(from, { item = "Biryani", qty = "qty:2" } = {}) {
  let r = await chat(from, { text: "hi" });
  r = await chat(from, tap(r, w.vendor.shop_name));
  r = await chat(from, tap(r, item));
  r = await chat(from, { button_id: qty });
  return chat(from, tap(r, "Order"));
}
const near = (km) => ({ lat: pinAt(km).drop_lat, lng: pinAt(km).drop_lng });
async function placeViaChat(from, km = 1) {
  let r = await toAddress(from);
  r = await chat(from, { text: "Kizhissery, near the mosque" });
  r = await chat(from, { location: near(km) });
  assert.match(bodies(r), /Total/);
  return chat(from, { button_id: "confirm:yes" });
}
const FROM = "919847000011";

// ── the order conversation ───────────────────────────────────────────────────
describe("WhatsApp ordering flow", () => {
  it("a full order: shop -> item -> quantity -> address -> location -> confirm (zone from distance)", async () => {
    const placed = await placeViaChat(FROM);
    assert.match(bodies(placed), /Order placed/);
    const order = await prisma.order.findFirst({ include: { items: true } });
    assert.equal(order.channel, "WHATSAPP");
    assert.equal(order.customer_phone, "9847000011");
    assert.equal(order.order_status, "RIDER_REQUESTED");
    assert.equal(order.item_total.toString(), "200");
    assert.equal(order.drop_address, "Kizhissery, near the mosque");
    assert.equal(Number(order.drop_lat), near(1).lat);
    assert.equal(order.zone_id, w.zones[0].id);
    assert.equal(order.zone_source, "AUTO");
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.vendor_id, w.vendor.id);
  });

  it("a non-Indian number gets a polite refusal and no session", async () => {
    const r = await chat("14155550123", { text: "hi" });
    assert.match(bodies(r), /Indian mobile/);
    assert.equal(await prisma.whatsappSession.count(), 0);
  });

  it("shows the offer price and 'only N left', and clamps a quantity above the stock", async () => {
    await prisma.product.update({
      where: { id: w.products.biryani.id },
      data: { offer_price: "80.00", offer_label: "Sale", stock_qty: 2 },
    });
    let r = await chat(FROM, { text: "hi" });
    r = await chat(FROM, tap(r, w.vendor.shop_name));
    const row = options(r).find((o) => o.title === "Biryani");
    assert.match(row.description, /₹80/);
    assert.match(row.description, /was ₹100/);
    assert.match(row.description, /only 2 left/);
    r = await chat(FROM, { list_id: row.id });
    r = await chat(FROM, { button_id: "qty:other" });
    r = await chat(FROM, { text: "5" });
    assert.match(bodies(r), /Only 2/);
    assert.match(bodies(r), /2 × Biryani/);
  });

  it("sold-out items are not offered", async () => {
    await prisma.product.update({ where: { id: w.products.biryani.id }, data: { stock_qty: 0 } });
    let r = await chat(FROM, { text: "hi" });
    r = await chat(FROM, tap(r, w.vendor.shop_name));
    assert.ok(!options(r).some((o) => o.title === "Biryani"));
  });

  it("a long menu is paged: 9 rows plus a More row", async () => {
    for (let i = 0; i < 12; i++) {
      await prisma.product.create({ data: { vendor_id: w.vendor.id, name: `Extra dish ${i}`, price: "50.00" } });
    }
    let r = await chat(FROM, { text: "hi" });
    r = await chat(FROM, tap(r, w.vendor.shop_name));
    const rows = options(r);
    assert.equal(rows.length, 10);
    assert.equal(rows[9].id, "more:items:1");
    const page2 = await chat(FROM, { list_id: "more:items:1" });
    assert.ok(options(page2).length >= 2);
    assert.ok(!options(page2).some((o) => o.id === rows[0].id), "page 2 must not repeat page 1");
  });

  it("the second order offers the saved address and needs no location", async () => {
    await placeViaChat(FROM);
    let r = await toAddress(FROM);
    assert.match(bodies(r), /near the mosque/);
    r = await chat(FROM, { button_id: "addr:saved" });
    assert.match(bodies(r), /Total/); // straight to the confirmation
  });

  it("an idle chat starts over after two hours", async () => {
    let r = await chat(FROM, { text: "hi" });
    r = await chat(FROM, tap(r, w.vendor.shop_name));
    await prisma.whatsappSession.updateMany({ data: { updated_at: new Date(Date.now() - 3 * 3600_000) } });
    r = await chat(FROM, { button_id: "qty:1" });
    assert.equal(r[0].type, "list");
    assert.match(r[0].body, /Which shop/);
  });

  it("cannot flood orders: the sixth in ten minutes is refused", async () => {
    const phone = "9847000012";
    for (let i = 0; i < 5; i++) {
      const res = await api("POST", "/marketplace/checkout", {
        body: { vendor_id: w.vendor.id, ...pinAt(1), customer_phone: phone, drop_address: "Somewhere", items: [{ product_id: w.products.biryani.id, quantity: 2 }] },
      });
      assert.equal(res.status, 201);
    }
    let r = await toAddress("91" + phone);
    assert.match(bodies(r), /Somewhere/); // a returning customer is offered the saved address
    r = await chat("91" + phone, { button_id: "addr:new" });
    r = await chat("91" + phone, { text: "Kizhissery, near the mosque" });
    r = await chat("91" + phone, { location: near(1) });
    r = await chat("91" + phone, { button_id: "confirm:yes" });
    assert.match(bodies(r), /Too many orders/);
    assert.equal(await prisma.order.count({ where: { channel: "WHATSAPP" } }), 0);
  });

  it("'cancel' withdraws an order that no rider has taken, and gives the stock back", async () => {
    await prisma.product.update({ where: { id: w.products.biryani.id }, data: { stock_qty: 5 } });
    await placeViaChat(FROM);
    assert.equal((await prisma.product.findUnique({ where: { id: w.products.biryani.id } })).stock_qty, 3);
    let r = await chat(FROM, { text: "cancel" });
    r = await chat(FROM, tap(r, "Yes, cancel"));
    assert.match(bodies(r), /cancelled/i);
    assert.equal((await prisma.order.findFirst()).order_status, "CANCELLED");
    assert.equal((await prisma.product.findUnique({ where: { id: w.products.biryani.id } })).stock_qty, 5);
  });

  it("'status' reports the order with its tracking link", async () => {
    await placeViaChat(FROM);
    const r = await chat(FROM, { text: "status" });
    assert.match(bodies(r), /Finding a rider/);
    assert.match(bodies(r), /\/drop\//);
  });

  it("the delivery charge follows the distance: ~3 km is Zone 2 (Rs 40) and the confirmation shows it", async () => {
    let r = await toAddress(FROM);
    r = await chat(FROM, { text: "Kizhissery, near the mosque" });
    r = await chat(FROM, { location: near(3) });
    assert.match(bodies(r), /₹40/);
    assert.match(bodies(r), /km\)/);
    await chat(FROM, { button_id: "confirm:yes" });
    const order = await prisma.order.findFirst();
    assert.equal(order.zone_id, w.zones[1].id);
  });

  it("a location outside the delivery area is refused and asked for again", async () => {
    let r = await toAddress(FROM);
    r = await chat(FROM, { text: "Kizhissery, near the mosque" });
    r = await chat(FROM, { location: near(9) });
    assert.match(bodies(r), /outside our delivery area/);
    assert.ok(r.some((m) => m.type === "location_request"));
    assert.equal(await prisma.order.count(), 0);
  });

  it("no location, no order: the Help button gives the hotel's number", async () => {
    let r = await toAddress(FROM);
    r = await chat(FROM, { text: "Kizhissery, near the mosque" });
    assert.ok(r.some((m) => m.type === "location_request"));
    r = await chat(FROM, { button_id: "loc:help" });
    assert.match(bodies(r), new RegExp(w.vendor.shop_name));
    r = await chat(FROM, { button_id: "confirm:yes" }); // cannot skip to the end
    assert.equal(await prisma.order.count(), 0);
  });
});

// ── webhook ──────────────────────────────────────────────────────────────────
const sign = (raw) => "sha256=" + crypto.createHmac("sha256", "test-app-secret").update(raw).digest("hex");
const webhook = (messages, { signature, phone_number_id = "1000200030" } = {}) => {
  const raw = JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id }, contacts: [{ wa_id: FROM, profile: { name: "Ravi" } }], messages } }] }],
  });
  return fetch(`${server.url}/api/v1/whatsapp/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": signature ?? sign(raw) },
    body: raw,
  });
};
const textMsg = (id, body = "hi") => ({ from: FROM, id, type: "text", text: { body } });

describe("WhatsApp webhook", () => {
  it("answers Meta's verification handshake only with the right token", async () => {
    const ok = await fetch(`${server.url}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "12345");
    const bad = await fetch(`${server.url}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
    assert.equal(bad.status, 403);
  });

  it("rejects a bad or missing signature", async () => {
    assert.equal((await webhook([textMsg("wamid.1")], { signature: "sha256=" + "0".repeat(64) })).status, 401);
    const raw = "{}";
    const res = await fetch(`${server.url}/api/v1/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
    assert.equal(res.status, 401);
  });

  it("handles a signed message and sends the reply", async () => {
    const sent = [];
    setWhatsappClientForTests(async (to, message) => sent.push({ to, message }));
    assert.equal((await webhook([textMsg("wamid.A")])).status, 200);
    await waitFor(() => sent.length > 0);
    assert.equal(sent[0].to, FROM);
    assert.equal(sent[0].message.type, "list");
  });

  it("a retried message id is handled once", async () => {
    const sent = [];
    setWhatsappClientForTests(async (to, message) => sent.push({ to, message }));
    await webhook([textMsg("wamid.B")]);
    await waitFor(() => sent.length > 0);
    await webhook([textMsg("wamid.B")]);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sent.length, 1);
  });

  it("ignores an unknown business number and a disabled franchise", async () => {
    const sent = [];
    setWhatsappClientForTests(async (to, message) => sent.push({ to, message }));
    await webhook([textMsg("wamid.C")], { phone_number_id: "999" });
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { whatsapp_enabled: false } });
    await webhook([textMsg("wamid.D")]);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(sent.length, 0);
  });
});

// ── status updates ───────────────────────────────────────────────────────────
describe("WhatsApp status updates", () => {
  it("tells a WhatsApp customer when the rider accepts, picks up and delivers", async () => {
    await placeViaChat(FROM);
    const order = await prisma.order.findFirst();
    const sent = [];
    setWhatsappClientForTests(async (to, message) => sent.push({ to, text: message.body }));

    const rider = w.riders[0];
    assert.equal((await accept(api, rider, order.id)).status, 200);
    assert.equal((await pickup(api, w, rider, { id: order.id, phone: "9847000011" })).status, 200);
    assert.equal((await deliver(api, rider, order.id)).status, 200);
    await waitFor(() => sent.length >= 3);
    assert.ok(sent.every((m) => m.to === FROM));
    assert.match(sent[0].text, /accepted|ഓർഡർ എടുത്തു/);
    assert.match(sent[1].text, /picked up/);
    assert.match(sent[2].text, /Delivered/);
    assert.ok(sent.every((m) => m.text.includes(order.order_number)));
  });

  it("an admin cancel is announced; a web order sends nothing", async () => {
    await placeViaChat(FROM);
    const order = await prisma.order.findFirst();
    const sent = [];
    setWhatsappClientForTests(async (to, message) => sent.push(message.body));
    const web = await placeOrder(api, w, { phone: nextPhone() });
    await accept(api, w.riders[0], web.id);
    const res = await api("POST", `/orders/${order.id}/cancel`, { token: w.adminToken, body: { reason: "Hotel closed early" } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await waitFor(() => sent.length > 0);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Hotel closed early/);
  });
});
