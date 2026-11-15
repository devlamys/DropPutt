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
