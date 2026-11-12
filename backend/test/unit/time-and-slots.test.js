import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProductInSlot, slotWindowLabel } from "../../src/utils/slots.js";
import { isChayakadiWindow, istDayRange, istMinutesOfDay } from "../../src/utils/time.js";

// 2026-11-12 at the given IST clock time.
const ist = (hhmm) => new Date(`2026-11-12T${hhmm}:00+05:30`);

describe("Asia/Kolkata helpers (§26)", () => {
  it("minutes of day are IST, independent of the server timezone", () => {
    assert.equal(istMinutesOfDay(new Date("2026-11-12T00:00:00Z")), 5 * 60 + 30);
    assert.equal(istMinutesOfDay(ist("15:00")), 15 * 60);
  });
  it("the 4 PM window is 15:00 ≤ t < 18:00 IST", () => {
    assert.equal(isChayakadiWindow(ist("14:59")), false);
    assert.equal(isChayakadiWindow(ist("15:00")), true);
    assert.equal(isChayakadiWindow(ist("17:59")), true);
    assert.equal(isChayakadiWindow(ist("18:00")), false);
  });
  it("the IST day boundary is midnight Kolkata, not UTC", () => {
    const late = new Date("2026-11-12T19:00:00Z"); // 00:30 on the 13th in IST
    assert.equal(istDayRange(late).date, "2026-11-13");
    assert.equal(istDayRange(ist("23:59")).date, "2026-11-12");
  });
});

describe("product time slots (§40)", () => {
  const at = (hhmm) => istMinutesOfDay(ist(hhmm));
  it("ALL_DAY is always available", () => {
    assert.equal(isProductInSlot({ slot_type: "ALL_DAY" }, at("03:00")), true);
  });
  it("EVENING_SNACKS_3_TO_6 only between 15:00 and 18:00", () => {
    const p = { slot_type: "EVENING_SNACKS_3_TO_6" };
    assert.equal(isProductInSlot(p, at("14:59")), false);
    assert.equal(isProductInSlot(p, at("16:00")), true);
    assert.equal(isProductInSlot(p, at("18:00")), false);
  });
  it("LUNCH_ONLY and DINNER_ONLY use their default windows", () => {
    assert.equal(isProductInSlot({ slot_type: "LUNCH_ONLY" }, at("12:00")), true);
    assert.equal(isProductInSlot({ slot_type: "LUNCH_ONLY" }, at("19:00")), false);
    assert.equal(isProductInSlot({ slot_type: "DINNER_ONLY" }, at("19:00")), true);
  });
  it("a product's own from/to override the slot, including across midnight", () => {
    const night = { slot_type: "ALL_DAY", available_from: "22:00", available_to: "02:00" };
    assert.equal(isProductInSlot(night, at("23:30")), true);
    assert.equal(isProductInSlot(night, at("01:00")), true);
    assert.equal(isProductInSlot(night, at("12:00")), false);
  });
  it("describes when a product is available", () => {
    assert.equal(slotWindowLabel({ slot_type: "ALL_DAY" }), null);
    assert.equal(slotWindowLabel({ slot_type: "LUNCH_ONLY" }), "11 AM – 3 PM");
    assert.equal(slotWindowLabel({ slot_type: "EVENING_SNACKS_3_TO_6" }), "3 PM – 6 PM");
    assert.equal(slotWindowLabel({ slot_type: "ALL_DAY", available_from: "06:30", available_to: "00:15" }), "6:30 AM – 12:15 AM");
  });
});
