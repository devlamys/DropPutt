import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LIMITS, normalizeMessage, toGraphPayload } from "../../src/services/whatsapp/client.js";

describe("WhatsApp message limits", () => {
  it("keeps buttons to 3 with short titles", () => {
    const m = normalizeMessage({
      type: "buttons",
      body: "x",
      buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: "A very long button title indeed" })),
    });
    assert.equal(m.buttons.length, LIMITS.buttons);
    assert.ok(m.buttons.every((b) => b.title.length <= LIMITS.buttonTitle));
  });

  it("keeps list rows to 10 with short titles and descriptions", () => {
    const m = normalizeMessage({
      type: "list",
      body: "x",
      rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, title: "T".repeat(40), description: "D".repeat(120) })),
    });
    assert.equal(m.rows.length, LIMITS.rows);
    assert.ok(m.rows.every((r) => r.title.length <= LIMITS.rowTitle && r.description.length <= LIMITS.rowDescription));
  });

  it("builds the Cloud API payloads", () => {
    const list = toGraphPayload("919847000001", normalizeMessage({ type: "list", body: "b", button: "Go", rows: [{ id: "1", title: "One" }] }));
    assert.equal(list.interactive.type, "list");
    assert.equal(list.interactive.action.sections[0].rows[0].id, "1");
    const loc = toGraphPayload("919847000001", { type: "location_request", body: "where?" });
    assert.equal(loc.interactive.type, "location_request_message");
    assert.equal(loc.interactive.action.name, "send_location");
    assert.equal(toGraphPayload("1", { type: "text", body: "hi" }).type, "text");
  });
});
