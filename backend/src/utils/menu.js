// Menu rules shared by the vendor app, the marketplace feed and the cart
// (SPEC "Vendor menu management"): offers, stock and archived items.

import { money } from "./orderMath.js";
import { isProductInSlot } from "./slots.js";

/** True while the hotel's offer applies (price set and not past its end time). */
export function isOfferActive(product, now = new Date()) {
  if (product.offer_price == null) return false;
  if (!product.offer_ends_at) return true;
  return product.offer_ends_at > now;
}

/** What the customer pays for one unit right now. */
export function effectivePrice(product, now = new Date()) {
  return isOfferActive(product, now) ? money(product.offer_price) : money(product.price);
}

/** null stock = unlimited; otherwise at least one portion left. */
export const hasStock = (product) => product.stock_qty == null || product.stock_qty > 0;

/** Portions left, only when it is worth telling the customer (5 or fewer). */
export const stockLeft = (product) =>
  product.stock_qty != null && product.stock_qty > 0 && product.stock_qty <= 5
    ? product.stock_qty
    : null;

/** Can a customer order this right now? */
export const isSellable = (product, minutesOfDay, now = new Date()) =>
  !product.is_archived &&
  product.is_available &&
  hasStock(product) &&
  isProductInSlot(product, minutesOfDay);

export const FOOD_CATEGORIES = Object.freeze([
  { key: "MEALS", label: "Meals" },
  { key: "BIRYANI", label: "Biryani" },
  { key: "FAST_FOOD", label: "Fast food" },
  { key: "SNACKS", label: "Chai & snacks" },
  { key: "JUICE_SHAKES", label: "Juice & shakes" },
  { key: "BAKERY_SWEETS", label: "Bakery & sweets" },
  { key: "OTHER", label: "Other" },
]);

const GUESSES = [
  ["BIRYANI", /biriyani|biryani|ബിരിയാണി|mandi|kuzhi/i],
  ["JUICE_SHAKES", /juice|shake|lime|soda|lassi|falooda|mojito|ജ്യൂസ്/i],
  ["FAST_FOOD", /burger|pizza|wrap|sandwich|fries|shawarma|roll|noodles|fried rice|momo|nugget/i],
  ["BAKERY_SWEETS", /cake|puff|bun|cookie|brownie|ice cream|dessert|pudding|sweet|laddu|halwa/i],
  ["SNACKS", /chai|tea|coffee|vada|bonda|pazham|samosa|cutlet|pakoda|unniyappam|ചായ|കടി/i],
  ["MEALS", /meals|thali|parotta|porotta|appam|dosa|idli|puttu|curry|fry|chicken|beef|fish|egg|ഊണ്/i],
];

/** Default food category for a new item whose vendor did not choose one. */
export function guessFoodCategory(name, slot_type) {
  const hit = GUESSES.find(([, pattern]) => pattern.test(name));
  if (hit) return hit[0];
  return slot_type === "EVENING_SNACKS_3_TO_6" ? "SNACKS" : "OTHER";
}
