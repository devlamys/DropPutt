import "../helpers/env.js";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeOtherWorld, makeWorld, nextPhone, pinAt } from "../helpers/fixtures.js";
import { accept, deliver, placeOrder, uuid } from "../helpers/flow.js";
import { clearDistanceCache } from "../../src/services/routeService.js";
import { clearGeocodeCache } from "../../src/services/geocodeService.js";

let server, api, w, other, osrm, osrmMetres = null, geocoder, geocoderCalls = 0;
before(async () => {
  osrm = http.createServer((req, res) => {
    if (osrmMetres === null) return res.writeHead(500).end("boom");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "Ok", routes: [{ distance: osrmMetres, duration: 100 }] }));
  });
  geocoder = http.createServer((req, res) => {
    geocoderCalls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ display_name: "Kizhissery, Malappuram, Kerala, India", lat: "11.18", lon: "76.07" }]));
  });
  await Promise.all([osrm, geocoder].map((s) => new Promise((r) => s.listen(0, "127.0.0.1", r))));
  process.env.GEOCODER_URL = `http://127.0.0.1:${geocoder.address().port}`;
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(async () => {
  process.env.ROUTING_URL = "";
  await Promise.all([osrm, geocoder].map((s) => new Promise((r) => s.close(r))));
  await server.close();
});
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  other = await makeOtherWorld();
  process.env.ROUTING_URL = "";
  osrmMetres = null;
  geocoderCalls = 0;
  clearDistanceCache();
  clearGeocodeCache();
});

const quote = (km, extra = {}) => api("POST", "/marketplace/delivery-quote", { body: { vendor_id: w.vendor.id, lat: pinAt(km).drop_lat, lng: pinAt(km).drop_lng, ...extra } });
const checkout = (body) =>
  api("POST", "/marketplace/checkout", {
    body: { vendor_id: w.vendor.id, customer_phone: nextPhone(), drop_address: "Blue gate house", items: [{ product_id: w.products.biryani.id, quantity: 2 }], ...body },
  });

describe("delivery quote and checkout by pin", () => {
  it("quotes the fee from the distance, with no zone chosen", async () => {
    const near = await quote(1);
    assert.equal(near.status, 200, JSON.stringify(near.body));
    assert.equal(near.body.data.delivery_fee, "30.00");
    assert.equal((await quote(3)).body.data.delivery_fee, "40.00");
    assert.equal((await quote(7)).body.data.delivery_fee, "50.00");
    const far = (await quote(9)).body.data;
    assert.equal(far.deliverable, false);
    assert.match(far.message, /outside our delivery area/);
  });

  it("uses the road distance when a router is available", async () => {
    process.env.ROUTING_URL = `http://127.0.0.1:${osrm.address().port}`;
    osrmMetres = 6200; // the straight line would be Zone 1; the road says 6.2 km
    assert.equal((await quote(1)).body.data.delivery_fee, "50.00");
    clearDistanceCache();
    osrmMetres = null; // router down: falls back to the straight-line estimate
    assert.equal((await quote(1)).body.data.delivery_fee, "30.00");
  });

  it("checkout stores the automatic zone and ignores a zone the client sends", async () => {
    const res = await checkout({ ...pinAt(3), zone_id: w.zones[0].id });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.delivery_fee, "40.00");
    const order = await prisma.order.findFirst();
    assert.equal(order.zone_id, w.zones[1].id);
    assert.equal(order.zone_source, "AUTO");
    assert.equal(Number(order.drop_lat), pinAt(3).drop_lat);
  });

  it("checkout needs a pin, and refuses one outside the delivery area (nothing is saved)", async () => {
    assert.equal((await checkout({})).status, 422);
    const far = await checkout(pinAt(9));
    assert.equal(far.status, 422);
    assert.equal(far.body.error.code, "OUTSIDE_DELIVERY_AREA");
    assert.equal(await prisma.order.count(), 0);
    assert.equal((await checkout({ drop_lat: 25.2, drop_lng: 55.27 })).status, 422); // abroad
  });

  it("a franchise cannot quote another franchise's hotel", async () => {
    const res = await api("POST", "/marketplace/delivery-quote", { body: { vendor_id: other.vendor.id, lat: 11, lng: 76 } });
    assert.equal(res.status, 422);
  });
});

describe("franchise admin: delivery zones and maximum distance", () => {
  const admin = (m, p, body) => api(m, `/admin${p}`, { token: w.adminToken, body });

  it("lists, adds, edits and deletes distance bands", async () => {
    const list = await admin("GET", "/zones");
    assert.deepEqual(list.body.data.zones.map((z) => z.max_km), ["2.00", "5.00", "8.00"]);
    const added = await admin("POST", "/zones", { zone_name: "Zone 4 — Far", max_km: 12, delivery_fee: "70" });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    const id = added.body.data.zone.id;
    assert.equal((await admin("PATCH", `/zones/${id}`, { delivery_fee: "75.00" })).body.data.zone.delivery_fee, "75.00");
    assert.equal((await admin("DELETE", `/zones/${id}`)).status, 200);
  });

  it("refuses a duplicate name or band edge, and deleting a zone that has orders or the last zone", async () => {
    assert.equal((await admin("POST", "/zones", { zone_name: "zone 1", max_km: 3, delivery_fee: "10" })).body.error.code, "DUPLICATE_ZONE");
    assert.equal((await admin("POST", "/zones", { zone_name: "Another", max_km: 5, delivery_fee: "10" })).body.error.code, "DUPLICATE_BAND");
    await checkout(pinAt(1));
    assert.equal((await admin("DELETE", `/zones/${w.zones[0].id}`)).body.error.code, "ZONE_IN_USE");
    await prisma.zone.deleteMany({ where: { franchise_id: w.franchise.id, id: { not: w.zones[2].id } } });
    assert.equal((await admin("DELETE", `/zones/${w.zones[2].id}`)).body.error.code, "LAST_ZONE");
  });

  it("the maximum delivery distance is editable and takes effect at once", async () => {
    assert.equal((await quote(10)).body.data.deliverable, false);
    const res = await admin("PATCH", "/franchise/settings", { max_delivery_km: 12 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.franchise.max_delivery_km, "12.00");
    assert.equal((await quote(10)).body.data.deliverable, true);
    assert.equal((await admin("PATCH", "/franchise/settings", { max_delivery_km: 80 })).status, 422);
  });

  it("only the franchise admin, and only inside their own franchise", async () => {
    for (const [method, path, body] of [["GET", "/zones"], ["POST", "/zones", { zone_name: "X1", max_km: 3, delivery_fee: "9" }]]) {
      assert.equal((await api(method, `/admin${path}`, { token: w.vendorToken, body })).status, 403);
      assert.equal((await api(method, `/admin${path}`, { token: w.riders[0].token, body })).status, 403);
    }
    const foreign = await api("PATCH", `/admin/zones/${other.zones[0].id}`, { token: w.adminToken, body: { delivery_fee: "1" } });
    assert.equal(foreign.status, 404);
  });
});

describe("Call Rider Now: the zone at pickup", () => {
  const rider = () => w.riders[0];
  const pickupNow = (order, body) =>
    api("PUT", `/orders/${order.id}/rider-pickup`, { token: rider().token, body: { customer_phone: order.phone, payment_method: "COD", ...body } });

  async function acceptedOrder(phone, savedPinKm) {
    if (savedPinKm !== undefined) {
      await prisma.customer.create({
        data: { franchise_id: w.franchise.id, phone, lat: pinAt(savedPinKm).drop_lat, lng: pinAt(savedPinKm).drop_lng },
      });
    }
    const order = await placeOrder(api, w, { phone, storefront: false });
    assert.equal((await accept(api, rider(), order.id)).status, 200);
    return order;
  }

  it("a known customer location decides the zone; the rider does not have to choose", async () => {
    const order = await acceptedOrder("9847001111", 3);
    const hint = await api("GET", `/orders/${order.id}/suggested-zone`, { token: rider().token });
    assert.equal(hint.body.data.suggested.zone_id, w.zones[1].id);
    const res = await pickupNow(order, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.zone_id, w.zones[1].id);
    assert.equal(row.zone_source, "AUTO");
    assert.equal(row.delivery_fee.toString(), "40");
  });

  it("the rider can pick another zone: kept as RIDER_OVERRIDE", async () => {
    const order = await acceptedOrder("9847002222", 3);
    assert.equal((await pickupNow(order, { zone_id: w.zones[2].id })).status, 200);
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.zone_id, w.zones[2].id);
    assert.equal(row.zone_source, "RIDER_OVERRIDE");
  });

  it("with no known location the rider chooses, marked MANUAL, and must choose", async () => {
    const order = await acceptedOrder("9847003333");
    const hint = await api("GET", `/orders/${order.id}/suggested-zone`, { token: rider().token });
    assert.equal(hint.body.data.suggested, null);
    assert.equal((await pickupNow(order, {})).status, 422);
    assert.equal((await pickupNow(order, { zone_id: w.zones[0].id })).status, 200);
    assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).zone_source, "MANUAL");
  });

  it("another rider cannot read the suggestion", async () => {
    const order = await acceptedOrder("9847004444", 1);
    const res = await api("GET", `/orders/${order.id}/suggested-zone`, { token: w.riders[1].token });
    assert.equal(res.status, 403);
  });
});

describe("place search proxy", () => {
  it("returns places from the geocoder, and serves repeats from the cache", async () => {
    const res = await api("GET", "/public/geocode?q=Kizhissery", {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.places[0].lat, 11.18);
    await api("GET", "/public/geocode?q=kizhissery", {});
    assert.equal(geocoderCalls, 1);
  });

  it("rejects a too-short query and floods", async () => {
    assert.equal((await api("GET", "/public/geocode?q=ab", {})).status, 422);
    let limited = false;
    for (let i = 0; i < 25 && !limited; i++) limited = (await api("GET", `/public/geocode?q=place${i}x`, {})).status === 429;
    assert.ok(limited, "the 20-a-minute limit should apply");
  });
});
