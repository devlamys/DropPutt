import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { prisma } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld, pinAt } from "../helpers/fixtures.js";
import { distanceKm, resolveDelivery, STRAIGHT_LINE_FACTOR } from "../../src/services/deliveryZoneService.js";
import { haversineMetres } from "../../src/utils/geo.js";

let w;
const HOTEL = { lat: 11.0, lng: 76.0 };
const to = (km) => ({ lat: pinAt(km).drop_lat, lng: pinAt(km).drop_lng });
const resolve = (km) => resolveDelivery({ franchise_id: w.franchise.id, from: HOTEL, to: to(km) });

before(() => {
  process.env.ROUTING_URL = "";
});
after(async () => prisma.$disconnect());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
});

describe("distance", () => {
  it("haversine is right at any distance (Kizhissery to Dubai is about 2,500 km)", () => {
    const km = haversineMetres([11.0, 76.0], [25.2, 55.27]) / 1000;
    assert.ok(km > 2400 && km < 2700, String(km));
    assert.equal(Math.round(haversineMetres([11, 76], [11, 76])), 0);
  });

  it("with no router a straight line is stretched by the road factor", async () => {
    const straight = haversineMetres([11, 76], [11.018, 76]) / 1000;
    const { km, method } = await distanceKm(HOTEL, { lat: 11.018, lng: 76 });
    assert.equal(method, "STRAIGHT");
    assert.ok(Math.abs(km - Math.round(straight * STRAIGHT_LINE_FACTOR * 10) / 10) < 0.11);
  });
});

describe("zone from distance (bands 2 / 5 / 8 km, limit 8 km)", () => {
  it("picks the band the trip falls in", async () => {
    assert.equal((await resolve(1)).zone.id, w.zones[0].id);
    assert.equal((await resolve(3)).zone.id, w.zones[1].id);
    assert.equal((await resolve(7)).zone.id, w.zones[2].id);
  });

  it("a band includes its upper edge: 2.0 km is Zone 1, 2.1 km is Zone 2", async () => {
    assert.equal((await resolve(2.0)).zone.id, w.zones[0].id);
    assert.equal((await resolve(2.2)).zone.id, w.zones[1].id);
  });

  it("beyond the maximum distance nothing is deliverable", async () => {
    const r = await resolve(9);
    assert.equal(r.deliverable, false);
    assert.equal(r.reason, "TOO_FAR");
    assert.equal(r.zone, null);
  });

  it("the franchise limit moves the line: 10 km is allowed once the limit is 12", async () => {
    await prisma.franchise.update({ where: { id: w.franchise.id }, data: { max_delivery_km: "12" } });
    const r = await resolve(10);
    assert.equal(r.deliverable, true);
    assert.equal(r.zone.id, w.zones[2].id); // past the last band but within the limit: the last band
  });

  it("a customer's pin far away (abroad) is simply too far", async () => {
    const r = await resolveDelivery({ franchise_id: w.franchise.id, from: HOTEL, to: { lat: 25.2, lng: 55.27 } });
    assert.equal(r.deliverable, false);
  });

  it("rejects an invalid location and a franchise with no zones", async () => {
    assert.equal((await resolveDelivery({ franchise_id: w.franchise.id, from: HOTEL, to: { lat: 95, lng: 0 } })).reason, "INVALID_LOCATION");
    await prisma.zone.deleteMany({ where: { franchise_id: w.franchise.id } });
    assert.equal((await resolve(1)).reason, "NO_ZONES");
  });
});
