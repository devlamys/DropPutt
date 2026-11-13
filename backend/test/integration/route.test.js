import "../helpers/env.js";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld } from "../helpers/fixtures.js";
import { deliver, readyToDeliver, waitFor } from "../helpers/flow.js";
import { clearRouteCache, metresFromRoute } from "../../src/services/routeService.js";

// A fake OSRM: a road that bends (not the straight line between the points).
let osrm, osrmUrl, calls = [], failNext = false;
function fakeRoute(from, to) {
  const bend = [from[0], to[1]]; // go along one axis, then the other: an "L"
  return {
    code: "Ok",
    routes: [
      {
        distance: 1500,
        duration: 240,
        geometry: { type: "LineString", coordinates: [from, bend, to].map(([lat, lng]) => [lng, lat]) },
      },
    ],
  };
}

let server, rawApi, api, w;
const HOME = { lat: 11.01, lng: 76.01 };

before(async () => {
  osrm = http.createServer((req, res) => {
    const match = req.url.match(/\/route\/v1\/driving\/([\d.-]+),([\d.-]+);([\d.-]+),([\d.-]+)/);
    calls.push(req.url);
    if (failNext || !match) {
      res.writeHead(500).end("boom");
      return;
    }
    const [, lng1, lat1, lng2, lat2] = match.map(Number);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(fakeRoute([lat1, lng1], [lat2, lng2])));
  });
  await new Promise((r) => osrm.listen(0, "127.0.0.1", r));
  osrmUrl = `http://127.0.0.1:${osrm.address().port}`;

  server = await startServer();
  rawApi = client(server.url);
  api = (m, p, o) => rawApi(m, p, { slug: "tf", ...o });
});
after(async () => {
  process.env.ROUTING_URL = "";
  await new Promise((r) => osrm.close(r));
  await server.close();
});
beforeEach(async () => {
  await resetDb();
  clearRouteCache();
  calls = [];
  failNext = false;
  process.env.ROUTING_URL = osrmUrl;
  w = await makeWorld();
});

const orderRow = (id) => prisma.order.findUnique({ where: { id } });

/** Picked-up order whose customer has shared a good pin. */
async function onTheWay() {
  const order = await readyToDeliver(api, w);
  const pin = await api("POST", `/public/drop/${order.token}/voice-and-pin`, {
    body: { lat: HOME.lat, lng: HOME.lng, gps_accuracy: 8 },
  });
  assert.equal(pin.body.data.saved, true, JSON.stringify(pin.body));
  return order;
}

const ping = (order, lat, lng, rider = w.riders[0]) =>
  api("POST", "/riders/location-batch", {
    token: rider.token,
    body: { order_id: order.id, locations: [{ lat, lng, accuracy: 5, timestamp: Date.now() }] },
  });

describe("road route (rider → home)", () => {
  it("is fetched on the rider's first live position and served to customer and rider", async () => {
    const order = await onTheWay();
    assert.equal((await ping(order, 11.0, 76.0)).status, 200);

    const row = await waitFor(async () => (await orderRow(order.id)).route);
    assert.ok(row, "route stored");
    assert.equal(calls.length, 1);
    // OSRM is lng,lat; stored and served as [lat, lng].
    assert.deepEqual(row.coords[0], [11, 76]);
    assert.deepEqual(row.coords.at(-1), [HOME.lat, HOME.lng]);
    assert.equal(row.coords.length, 3, "follows the road, not a straight line");

    const pub = await api("GET", `/public/drop/${order.token}`);
    assert.equal(pub.body.data.route.distance_m, 1500);
    assert.equal(pub.body.data.route.duration_s, 240);
    assert.equal(pub.body.data.route.coords.length, 3);

    const mine = await api("GET", "/orders/active", { token: w.riders[0].token });
    const active = mine.body.data.orders.find((o) => o.id === order.id);
    assert.equal(active.route.coords.length, 3);
  });

  it("is not fetched again while the rider stays on it", async () => {
    const order = await onTheWay();
    await ping(order, 11.0, 76.0);
    await waitFor(async () => (await orderRow(order.id)).route);

    await ping(order, 11.0, 76.005); // on the first leg of the "L"
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls.length, 1);
  });

  it("is refetched when the rider leaves it — but at most every 30 s", async () => {
    const order = await onTheWay();
    await ping(order, 11.0, 76.0);
    await waitFor(async () => (await orderRow(order.id)).route);

    await ping(order, 10.99, 75.99); // ~1.5 km off the road, straight away
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls.length, 1, "throttled");

    await prisma.order.update({
      where: { id: order.id },
      data: { route_updated_at: new Date(Date.now() - 31_000) },
    });
    await ping(order, 10.99, 75.991);
    await waitFor(() => calls.length === 2);
    assert.equal(calls.length, 2);
    const row = await waitFor(async () => {
      const r = (await orderRow(order.id)).route;
      return r.coords[0][0] === 10.99 ? r : null;
    });
    assert.ok(row, "new route starts where the rider is now");
  });

  it("a broken router never breaks location updates", async () => {
    failNext = true;
    const order = await onTheWay();
    const res = await ping(order, 11.0, 76.0);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.accepted, 1);
    await waitFor(() => calls.length === 1);
    assert.equal((await orderRow(order.id)).route, null);
    const pub = await api("GET", `/public/drop/${order.token}`);
    assert.equal(pub.body.data.route, null); // the page draws a straight line
  });

  it("is off when ROUTING_URL is not set", async () => {
    process.env.ROUTING_URL = "";
    const order = await onTheWay();
    await ping(order, 11.0, 76.0);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls.length, 0);
    assert.equal((await orderRow(order.id)).route, null);
  });

  it("needs a drop point: no customer pin, no route call", async () => {
    const order = await readyToDeliver(api, w);
    await ping(order, 11.0, 76.0);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls.length, 0);
  });

  it("is hidden once the order is delivered", async () => {
    const order = await onTheWay();
    await ping(order, 11.0, 76.0);
    await waitFor(async () => (await orderRow(order.id)).route);
    assert.equal((await deliver(api, w.riders[0], order.id)).status, 200);

    const pub = await api("GET", `/public/drop/${order.token}`);
    assert.equal(pub.body.data.route, null);
  });
});

describe("route geometry", () => {
  it("measures distance from a point to the polyline", () => {
    const line = [[11.0, 76.0], [11.0, 76.01]];
    assert.ok(metresFromRoute([11.0, 76.005], line) < 1);
    const off = metresFromRoute([11.001, 76.005], line); // ~111 m north
    assert.ok(off > 100 && off < 125, `got ${off}`);
    assert.equal(metresFromRoute([11, 76], []), Infinity);
  });
});
