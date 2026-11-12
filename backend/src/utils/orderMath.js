// Order money math — the single money utility layer required by SPEC §2.3.
//
// Implements SPEC §8 (rounding helpers), §9 (grand total), §10 (vendor
// commission), §11 (normal split), §12 (launch-promo split), §13/§20
// (rain surge / tip additions) and §14 (amount_to_collect).
//
// Every function accepts Decimal | string | number and returns decimal.js
// Decimals rounded to 2 places (ROUND_HALF_UP). Never do money arithmetic
// with plain JS numbers outside this file.

import Decimal from "decimal.js";

export const PAYMENT_METHODS = Object.freeze({
  COD: "COD",
  PREPAID_AT_HOTEL: "PREPAID_AT_HOTEL",
  UPI_TO_ADMIN: "UPI_TO_ADMIN",
});

export const ALLOWED_TIP_AMOUNTS = Object.freeze([10, 20, 30]);

// ─── §8 Money / rounding standard ───────────────────────────────────────────

export function money(value) {
  return new Decimal(value ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function addMoney(...values) {
  return money(
    values.reduce((sum, value) => sum.plus(value ?? 0), new Decimal(0))
  );
}

export function subtractMoney(amount, ...values) {
  return money(
    values.reduce(
      (rest, value) => rest.minus(value ?? 0),
      new Decimal(amount ?? 0)
    )
  );
}

export function multiplyMoney(amount, quantity) {
  return money(new Decimal(amount).times(quantity));
}

export function percentageMoney(amount, percentage) {
  return money(new Decimal(amount).times(percentage).div(100));
}

// ─── §7 Line items ──────────────────────────────────────────────────────────

/** line_total = quantity × unit_price. Quantity must be a positive integer. */
export function calculateLineTotal(unit_price, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("quantity must be a positive integer");
  }
  return multiplyMoney(unit_price, quantity);
}

/** item_total = Σ(line_total). `lines` is [{ unit_price, quantity }]. */
export function calculateItemTotal(lines) {
  return addMoney(
    ...lines.map((line) => calculateLineTotal(line.unit_price, line.quantity))
  );
}

// ─── §10 Vendor commission ──────────────────────────────────────────────────

/**
 * Pass commission_rate = 0 (or omit) for custom-buy orders with no partner
 * vendor.
 */
export function calculateVendorCommission(item_total, commission_rate = 0) {
  const vendor_commission = percentageMoney(item_total, commission_rate);
  const vendor_earning = subtractMoney(item_total, vendor_commission);
  return { vendor_commission, vendor_earning };
}

// ─── §9 Grand total ─────────────────────────────────────────────────────────

export function calculateGrandTotal({
  item_total,
  delivery_fee,
  rider_tip = 0,
  discount_amount = 0,
}) {
  const grand_total = subtractMoney(
    addMoney(item_total, delivery_fee, rider_tip),
    discount_amount
  );
  if (grand_total.isNegative()) {
    throw new RangeError("grand_total must never be negative");
  }
  return grand_total;
}

// ─── §14 amount_to_collect ──────────────────────────────────────────────────

export function calculateAmountToCollect({
  payment_method,
  grand_total,
  delivery_fee,
  rider_tip = 0,
  delivery_side_discount = 0,
}) {
  switch (payment_method) {
    case PAYMENT_METHODS.COD:
      return money(grand_total);
    case PAYMENT_METHODS.PREPAID_AT_HOTEL:
      return subtractMoney(
        addMoney(delivery_fee, rider_tip),
        delivery_side_discount
      );
    case PAYMENT_METHODS.UPI_TO_ADMIN:
      return money(0);
    default:
      throw new TypeError(`Unsupported payment_method: ${payment_method}`);
  }
}

// ─── §16 Vendor ↔ platform ledger ───────────────────────────────────────────

/**
 * Signed amount added to vendor.admin_payable_balance at settlement.
 * Positive = the platform owes the vendor; negative = the vendor owes the
 * platform.
 *
 *   COD / UPI_TO_ADMIN  the platform side holds the item money and owes the
 *                       vendor vendor_earning (never the raw item_total).
 *   PREPAID_AT_HOTEL    the vendor already holds the full item money, so the
 *                       vendor owes the platform its commission.
 */
export function calculateVendorAdminPayable({
  payment_method,
  vendor_earning,
  vendor_commission,
}) {
  if (payment_method === PAYMENT_METHODS.PREPAID_AT_HOTEL) {
    return money(new Decimal(vendor_commission ?? 0).negated());
  }
  return money(vendor_earning);
}

// ─── §11 / §12 Four-way split ───────────────────────────────────────────────

/**
 * Normal mode (§11):
 *   rider_earning    = zone.rider_commission + rider_tip
 *   franchise_profit = zone.franchise_profit + shop_markup_profit
 *                      + vendor_commission - royalty_per_order
 *
 * Launch promo (§12):
 *   rider_earning    = zone.delivery_fee + rider_tip
 *   franchise_profit = shop_markup_profit + vendor_commission - royalty_per_order
 *
 * super_admin_profit = royalty_per_order in both modes. A negative
 * franchise_profit is kept as-is — it is never clamped to zero.
 */
export function calculateSplit({
  is_launch_promo_active = false,
  zone,
  rider_tip = 0,
  shop_markup_profit = 0,
  vendor_commission = 0,
  royalty_per_order = 0,
}) {
  const super_admin_profit = money(royalty_per_order);

  if (is_launch_promo_active) {
    return {
      rider_earning: addMoney(zone.delivery_fee, rider_tip),
      franchise_profit: subtractMoney(
        addMoney(shop_markup_profit, vendor_commission),
        royalty_per_order
      ),
      super_admin_profit,
    };
  }

  return {
    rider_earning: addMoney(zone.rider_commission, rider_tip),
    franchise_profit: subtractMoney(
      addMoney(zone.franchise_profit, shop_markup_profit, vendor_commission),
      royalty_per_order
    ),
    super_admin_profit,
  };
}

// ─── Full order financials (checkout / pickup) ──────────────────────────────

/**
 * Calculates every persisted financial field on Order in one pass.
 *
 * @param {object} input
 * @param {Decimal.Value} input.item_total          Σ OrderItem.line_total (or the bill amount for custom flows)
 * @param {{delivery_fee, rider_commission, franchise_profit}} input.zone
 * @param {{royalty_per_order, is_launch_promo_active}} input.franchise
 * @param {string} input.payment_method              COD | PREPAID_AT_HOTEL | UPI_TO_ADMIN
 * @param {Decimal.Value} [input.commission_rate]    vendor.commission_rate; 0 when there is no partner vendor
 * @param {Decimal.Value} [input.rider_tip]
 * @param {Decimal.Value} [input.discount_amount]
 * @param {Decimal.Value} [input.shop_markup_profit]
 * @param {boolean} [input.has_partner_vendor]       false for custom-buy / pick-drop
 */
export function calculateOrderFinancials({
  item_total,
  zone,
  franchise,
  payment_method,
  commission_rate = 0,
  rider_tip = 0,
  discount_amount = 0,
  shop_markup_profit = 0,
  has_partner_vendor = true,
}) {
  const itemTotal = money(item_total);
  const delivery_fee = money(zone.delivery_fee);
  const tip = money(rider_tip);
  const discount = money(discount_amount);
  const markup = money(shop_markup_profit);

  const { vendor_commission, vendor_earning } = has_partner_vendor
    ? calculateVendorCommission(itemTotal, commission_rate)
    : { vendor_commission: money(0), vendor_earning: money(0) };

  const grand_total = calculateGrandTotal({
    item_total: itemTotal,
    delivery_fee,
    rider_tip: tip,
    discount_amount: discount,
  });

  const amount_to_collect = calculateAmountToCollect({
    payment_method,
    grand_total,
    delivery_fee,
    rider_tip: tip,
  });

  const { rider_earning, franchise_profit, super_admin_profit } =
    calculateSplit({
      is_launch_promo_active: franchise.is_launch_promo_active,
      zone,
      rider_tip: tip,
      shop_markup_profit: markup,
      vendor_commission,
      royalty_per_order: franchise.royalty_per_order,
    });

  return {
    item_total: itemTotal,
    delivery_fee,
    rider_tip: tip,
    discount_amount: discount,
    shop_markup_profit: markup,
    grand_total,
    vendor_commission,
    vendor_earning,
    rider_earning,
    franchise_profit,
    super_admin_profit,
    amount_to_collect,
    vendor_admin_payable: has_partner_vendor
      ? calculateVendorAdminPayable({
          payment_method,
          vendor_earning,
          vendor_commission,
        })
      : money(0),
  };
}

// ─── §13 / §20 Rider-side additions (tip, rain surge) ───────────────────────

export function isAllowedTipAmount(value) {
  return ALLOWED_TIP_AMOUNTS.some((allowed) => new Decimal(allowed).eq(value ?? 0));
}

/**
 * Adds `amount` to rider_tip, rider_earning, grand_total and
 * amount_to_collect together (SPEC invariant 7). Returns only the four
 * changed fields. Idempotency (settlement reference_key,
 * rain_surge_applied) is the caller's responsibility.
 */
export function applyRiderAddition(order, amount) {
  const delta = money(amount);
  if (delta.isNegative()) {
    throw new RangeError("amount must not be negative");
  }
  return {
    rider_tip: addMoney(order.rider_tip, delta),
    rider_earning: addMoney(order.rider_earning, delta),
    grand_total: addMoney(order.grand_total, delta),
    amount_to_collect: addMoney(order.amount_to_collect, delta),
  };
}

export function applyTip(order, tip) {
  if (!isAllowedTipAmount(tip)) {
    throw new RangeError("tip must be 10, 20 or 30");
  }
  return applyRiderAddition(order, tip);
}

export function applyRainSurge(order, rain_surge_fee) {
  return applyRiderAddition(order, rain_surge_fee);
}

// ─── §15 Cash in hand at delivery ───────────────────────────────────────────

/**
 * Amount to add to rider.cash_in_hand on delivery. When the rider paid the
 * shop from their own pocket (custom-buy), their advance is not counted as
 * customer cash collected.
 */
export function calculateCashInHandIncrease(order) {
  if (order.rider_paid_at_shop) {
    return subtractMoney(order.grand_total, order.item_total);
  }
  return money(order.amount_to_collect);
}
