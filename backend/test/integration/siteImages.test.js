import "../helpers/env.js";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";
import { makeWorld, tokenFor } from "../helpers/fixtures.js";

let server, api, w, superToken;
before(async () => {
  server = await startServer();
  const raw = client(server.url);
  api = (m, p, o) => raw(m, p, { slug: "tf", ...o });
});
after(() => server.close());
beforeEach(async () => {
  await resetDb();
  w = await makeWorld();
  const user = await prisma.user.create({ data: { franchise_id: null, role: "SUPER_ADMIN", name: "Root", phone: "9888888888", pin_hash: "x" } });
  superToken = tokenFor(user);
});

const put = (slot, blob, token = superToken) => {
  const form = new FormData();
  form.set("image", blob, "tile.jpg");
  return api("PUT", `/super/site-images/${slot}`, { token, form });
};
const jpeg = (bytes = 2000) => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });

describe("home tile images (Super Admin)", () => {
  it("nothing is set at first; the Super Admin sets one and the public list shows it", async () => {
    assert.deepEqual((await api("GET", "/public/site-images", {})).body.data.images, {});
    const res = await put("restaurants", jpeg());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.data.image_url, /site\/restaurants\//);
    const list = (await api("GET", "/public/site-images", {})).body.data.images;
    assert.equal(list.restaurants, res.body.data.image_url);
    assert.equal(Object.keys(list).length, 1);
  });

  it("replacing a slot keeps one row; reset removes it", async () => {
    const first = await put("mart", jpeg());
    const second = await put("mart", jpeg(3000));
    assert.notEqual(first.body.data.image_url, second.body.data.image_url);
    assert.equal(await prisma.siteImage.count(), 1);
    assert.equal((await api("DELETE", "/super/site-images/mart", { token: superToken })).status, 200);
    assert.deepEqual((await api("GET", "/public/site-images", {})).body.data.images, {});
  });

  it("checks the slot, the file type and the size", async () => {
    assert.equal((await put("logo", jpeg())).status, 422);
    assert.equal((await put("pick_drop", new Blob(["x"], { type: "application/pdf" }))).status, 422);
    assert.equal((await put("pick_drop", jpeg(3 * 1024 * 1024 + 10))).status, 422);
    assert.equal(await prisma.siteImage.count(), 0);
  });

  it("only the Super Admin may change them", async () => {
    for (const token of [w.adminToken, w.vendorToken, w.riders[0].token]) {
      assert.equal((await put("chayakadi", jpeg(), token)).status, 403);
      assert.equal((await api("DELETE", "/super/site-images/chayakadi", { token })).status, 403);
    }
    assert.equal((await put("chayakadi", jpeg(), "")).status, 401);
    assert.equal(await prisma.siteImage.count(), 0);
  });
});
