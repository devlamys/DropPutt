// Cart validation shared by vendor quick-call and customer checkout (SPEC §7).

import { SNACK_MIN_ORDER_VALUE } from "../utils/constants.js";
import { addMoney, calculateLineTotal, money } from "../utils/orderMath.js";
import { fieldError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { isProductInSlot } from "../utils/slots.js";
import { isChayakadiWindow, istMinutesOfDay } from "../utils/time.js";


/**
 * Validates a cart against PostgreSQL and returns authoritative lines.
 * Repeated products are merged into one line.
 */
export async function buildCart(tx, vendor, items, now) {
  const quantities = new Map();
  for (const item of items) {
    quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + item.quantity);
  }

  // vendor_id pins the products to this vendor, and the vendor row was
  // already loaded with the tenant's franchise_id.
  const products = await tx.product.findMany({
    where: { id: { in: [...quantities.keys()] }, vendor_id: vendor.id },
  });
  if (products.length !== quantities.size) {
    throw fieldError("items", "one or more products do not belong to this vendor");
  }

  const minutes = istMinutesOfDay(now);
  const lines = products.map((product) => {
    if (!product.is_available || !isProductInSlot(product, minutes)) {
      throw fieldError("items", `"${product.name}" is not available right now`);
    }
    const quantity = quantities.get(product.id);
    return {
      product_id: product.id,
      quantity,
      unit_price: moneyStr(product.price),
      line_total: moneyStr(calculateLineTotal(product.price, quantity)),
      slot_type: product.slot_type,
    };
  });
  const item_total = addMoney(...lines.map((line) => line.line_total));

  // 15:00–18:00 IST: an all-snacks cart uses the ₹80 snack minimum (§26).
  const snackCart =
    isChayakadiWindow(now) &&
    lines.every((line) => line.slot_type === "EVENING_SNACKS_3_TO_6");
  const minimum = money(snackCart ? SNACK_MIN_ORDER_VALUE : vendor.min_order_value);
  if (item_total.lt(minimum)) {
    throw fieldError("items", `minimum order value is ₹${minimum.toFixed(2)}`);
  }

  return {
    item_total,
    lines: lines.map(({ slot_type, ...line }) => line),
  };
}
