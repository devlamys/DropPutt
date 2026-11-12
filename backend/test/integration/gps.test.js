import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { GPS_ACCURACY_WARNING_ML } from "../../src/utils/constants.js";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld } from "../helpers/fixtures.js";
import { readyToDeliver, deliver } from "../helpers/flow.js";

let server, api, w, order;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  order = await readyToDeliver(api, w);
});

const audio = (type = "audio/webm", bytes = 4000) => new Blob([new Uint8Array(bytes)], { type });
function pin({ accuracy, voice, turning_point, lat = 11.0123456, lng = 76.0123456 }) {
  const form = new FormData();
  form.set("lat", String(lat));
  form.set("lng", String(lng));
  form.set("gps_accuracy", String(accuracy));
  if (turning_point) form.set("turning_point", turning_point);
  if (voice) form.set("voice", voice, "route.webm");
  return api("POST", `/public/drop/${order.token}/voice-and-pin`, { form });
}
const customer = () => prisma.customer.findFirst({ where: { phone: order.phone } });

describe("rural GPS accuracy (§21, §39, §42)", () => {
  it("25 m → saved normally, no warning", async () => {
    const res = await pin({ accuracy: 25, turning_point: "Near mosque" });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.saved, true);
    assert.equal(res.body.data.gps_accuracy_poor, false);
    assert.equal(res.body.data.warning, null);
    assert.equal(res.body.data.order_status, "LOCATION_SHARED");
    const c = await customer();
    assert.equal(c.lat.toFixed(4), "11.0123");
    assert.equal(c.turning_point, "Near mosque");
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.drop_lat.toFixed(4), "11.0123");
  });

  it("exactly 50 m is still acceptable", async () => {
    assert.equal((await pin({ accuracy: 50 })).body.data.saved, true);
  });

  it("75 m and no voice → the exact Malayalam warning and nothing saved", async () => {
    const res = await pin({ accuracy: 75 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.saved, false);
    assert.equal(res.body.data.gps_accuracy_poor, true);
    assert.equal(res.body.data.warning.code, "GPS_ACCURACY_POOR");
    assert.equal(res.body.data.warning.message, GPS_ACCURACY_WARNING_ML);
    assert.equal((await customer()).lat, null); // the pickup created the row; no point was stored
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.drop_lat, null);
    assert.equal(row.order_status, "PICKED_UP");
  });

  it("75 m with a voice route → GPS and voice both saved, warning still returned", async () => {
    const res = await pin({ accuracy: 75, voice: audio() });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.saved, true);
    assert.equal(res.body.data.has_voice_note, true);
    assert.equal(res.body.data.gps_accuracy_poor, true);
    assert.equal(res.body.data.warning.code, "GPS_ACCURACY_POOR");
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.ok(row.voice_note_url);
    assert.equal(row.drop_lat.toFixed(4), "11.0123");
  });

  it("a rider-verified gate location stays the navigation target", async () => {
    await prisma.customer.update({
      where: { franchise_id_phone: { franchise_id: w.franchise.id, phone: order.phone } },
      data: { is_location_verified: true, verified_lat: "11.5000000", verified_lng: "76.5000000" },
    });
    await prisma.order.update({ where: { id: order.id }, data: { drop_lat: "11.5000000", drop_lng: "76.5000000" } });
    await pin({ accuracy: 10, lat: 11.9, lng: 76.9 });
    const row = await prisma.order.findUnique({ where: { id: order.id } });
    assert.equal(row.drop_lat.toFixed(1), "11.5");
  });

  it("sharing is refused once the order is delivered", async () => {
    await deliver(api, w.riders[0], order.id);
    const res = await pin({ accuracy: 10 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "ORDER_NOT_ACTIVE");
  });
});

describe("upload validation (§37.4)", () => {
  it("rejects a voice file of the wrong type", async () => {
    const res = await pin({ accuracy: 10, voice: new Blob(["<script>alert(1)</script>"], { type: "text/html" }) });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
  });

  it("rejects a voice file over 10 MB", async () => {
    const res = await pin({ accuracy: 10, voice: audio("audio/webm", 10 * 1024 * 1024 + 10) });
    assert.equal(res.status, 422);
  });

  it("rejects a non-image bill photo and an oversized one", async () => {
    const o2 = await readyToDeliver(api, w, w.riders[1]);
    const send = (blob) => {
      const form = new FormData();
      form.set("gate_photo", blob, "x.jpg");
      return api("POST", `/orders/${o2.id}/gate-photo`, { token: w.riders[1].token, form });
    };
    assert.equal((await send(new Blob(["not an image"], { type: "application/pdf" }))).status, 422);
    assert.equal((await send(new Blob([new Uint8Array(5 * 1024 * 1024 + 10)], { type: "image/jpeg" }))).status, 422);
    assert.equal((await send(new Blob([new Uint8Array(2000)], { type: "image/jpeg" }))).status, 200);
  });

  it("validates coordinates and accuracy", async () => {
    for (const bad of [{ lat: 123 }, { lng: 500 }, { accuracy: -5 }, { accuracy: "abc" }]) {
      const res = await pin({ accuracy: 10, ...bad });
      assert.equal(res.status, 422, JSON.stringify(bad));
    }
  });
});
