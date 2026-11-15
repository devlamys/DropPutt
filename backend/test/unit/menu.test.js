import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectivePrice, hasStock, isOfferActive, stockLeft } from "../../src/utils/menu.js";

const now = new Date("2026-11-15T10:00:00Z");
const base = { price: "200.00", offer_price: "160.00", offer_ends_at: null, stock_qty: null };

describe("menu rules", () => {
  it("an offer without an end time stays active; an ended one is ignored", () => {
    assert.equal(effectivePrice(base, now).toFixed(2), "160.00");
    assert.equal(effectivePrice({ ...base, offer_ends_at: new Date("2026-11-15T09:00:00Z") }, now).toFixed(2), "200.00");
    assert.equal(effectivePrice({ ...base, offer_ends_at: new Date("2026-11-16T09:00:00Z") }, now).toFixed(2), "160.00");
    assert.equal(isOfferActive({ price: "200.00", offer_price: null }, now), false);
  });

  it("stock: null is unlimited, 0 is sold out, the count shows only when 5 or fewer", () => {
    assert.equal(hasStock({ stock_qty: null }), true);
    assert.equal(hasStock({ stock_qty: 0 }), false);
    assert.equal(stockLeft({ stock_qty: 3 }), 3);
    assert.equal(stockLeft({ stock_qty: 6 }), null);
    assert.equal(stockLeft({ stock_qty: 0 }), null);
    assert.equal(stockLeft({ stock_qty: null }), null);
  });
});
