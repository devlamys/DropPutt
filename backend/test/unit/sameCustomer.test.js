import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameCustomer } from "../../src/services/dispatchService.js";

const order = (extra) => ({ customer_phone: null, drop_lat: null, drop_lng: null, ...extra });

test("same phone is the same customer", () => {
  assert.equal(isSameCustomer(order({ customer_phone: "9876543210" }), order({ customer_phone: "9876543210" })), true);
});

test("different phones far apart are different customers", () => {
  const a = order({ customer_phone: "9876543210", drop_lat: "11.1786", drop_lng: "75.9982" });
  const b = order({ customer_phone: "9123456780", drop_lat: "11.2000", drop_lng: "76.0200" });
  assert.equal(isSameCustomer(a, b), false);
});

test("different phones with drops within 150 m count as the same customer", () => {
  const a = order({ customer_phone: "9876543210", drop_lat: "11.178600", drop_lng: "75.998200" });
  const b = order({ customer_phone: "9123456780", drop_lat: "11.178900", drop_lng: "75.998300" }); // ~35 m
  assert.equal(isSameCustomer(a, b), true);
});

test("no phone and no drop point never matches", () => {
  assert.equal(isSameCustomer(order({}), order({})), false);
});
