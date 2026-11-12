import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMoney,
  applyRainSurge,
  applyTip,
  calculateAmountToCollect,
  calculateCashInHandIncrease,
  calculateGrandTotal,
  calculateLineTotal,
  calculateOrderFinancials,
  calculateSplit,
  calculateVendorAdminPayable,
  calculateVendorCommission,
  isAllowedTipAmount,
  money,
} from "../../src/utils/orderMath.js";

const s = (d) => d.toFixed(2);

describe("rounding (§8)", () => {
  it("rounds half up to two places", () => {
    assert.equal(s(money("1.005")), "1.01");
    assert.equal(s(money("2.344")), "2.34");
    assert.equal(s(addMoney("0.1", "0.2")), "0.30"); // no binary float drift
  });
  it("line total is quantity × price and rejects bad quantities", () => {
    assert.equal(s(calculateLineTotal("33.33", 3)), "99.99");
    assert.throws(() => calculateLineTotal(10, 0), RangeError);
    assert.throws(() => calculateLineTotal(10, 1.5), RangeError);
  });
});

describe("grand total (§9)", () => {
  it("adds item, delivery and tip, minus discount", () => {
    assert.equal(s(calculateGrandTotal({ item_total: 100, delivery_fee: 30, rider_tip: 20, discount_amount: 10 })), "140.00");
  });
  it("is never negative", () => {
    assert.throws(() => calculateGrandTotal({ item_total: 10, delivery_fee: 0, discount_amount: 50 }), RangeError);
  });
});

describe("vendor commission (§10)", () => {
  it("commission = item_total × rate, earning is the remainder", () => {
    const r = calculateVendorCommission(150, 10);
    assert.equal(s(r.vendor_commission), "15.00");
    assert.equal(s(r.vendor_earning), "135.00");
  });
  it("rounds the commission", () => {
    const r = calculateVendorCommission("33.33", 10);
    assert.equal(s(r.vendor_commission), "3.33");
    assert.equal(s(r.vendor_earning), "30.00");
  });
});

describe("four-way split (§11, §12)", () => {
  const base = {
    zone: { delivery_fee: 50, rider_commission: 25, franchise_profit: 20 },
    rider_tip: 20,
    shop_markup_profit: 10,
    vendor_commission: 15,
    royalty_per_order: 3,
  };

  it("launch promo: rider keeps the whole delivery fee (spec example)", () => {
    const r = calculateSplit({ ...base, is_launch_promo_active: true });
    assert.equal(s(r.rider_earning), "70.00"); // 50 + 20
    assert.equal(s(r.franchise_profit), "22.00"); // 10 + 15 - 3, NOT zero
    assert.equal(s(r.super_admin_profit), "3.00");
  });

  it("normal mode: rider commission + tip; franchise keeps its share", () => {
    const r = calculateSplit({ ...base, is_launch_promo_active: false });
    assert.equal(s(r.rider_earning), "45.00"); // 25 + 20
    assert.equal(s(r.franchise_profit), "42.00"); // 20 + 10 + 15 - 3
    assert.equal(s(r.super_admin_profit), "3.00");
  });

  it("a negative franchise profit is kept, never clamped to zero", () => {
    const r = calculateSplit({
      ...base,
      is_launch_promo_active: true,
      shop_markup_profit: 0,
      vendor_commission: 0,
    });
    assert.equal(s(r.franchise_profit), "-3.00");
  });
});

describe("amount to collect (§14)", () => {
  const order = { grand_total: 180, delivery_fee: 30, rider_tip: 20 };
  it("COD collects the grand total", () => {
    assert.equal(s(calculateAmountToCollect({ payment_method: "COD", ...order })), "180.00");
  });
  it("prepaid at hotel collects delivery + tip only", () => {
    assert.equal(s(calculateAmountToCollect({ payment_method: "PREPAID_AT_HOTEL", ...order })), "50.00");
  });
  it("UPI to admin collects nothing", () => {
    assert.equal(s(calculateAmountToCollect({ payment_method: "UPI_TO_ADMIN", ...order })), "0.00");
  });
  it("rejects an unknown method", () => {
    assert.throws(() => calculateAmountToCollect({ payment_method: "BITCOIN", ...order }), TypeError);
  });
});

describe("tip and rain surge additions (§13, §20)", () => {
  const order = { rider_tip: 0, rider_earning: 27, grand_total: 140, amount_to_collect: 140 };
  it("a ₹20 tip raises all four fields together", () => {
    const r = applyTip(order, 20);
    assert.deepEqual(
      [s(r.rider_tip), s(r.rider_earning), s(r.grand_total), s(r.amount_to_collect)],
      ["20.00", "47.00", "160.00", "160.00"]
    );
  });
  it("only ₹10 / ₹20 / ₹30 are valid tips", () => {
    for (const ok of [10, 20, 30, "20"]) assert.equal(isAllowedTipAmount(ok), true);
    for (const bad of [0, 5, 15, 25, 40, -10, "abc"]) assert.equal(isAllowedTipAmount(bad), false);
    assert.throws(() => applyTip(order, 15), RangeError);
  });
  it("rain surge uses the same addition", () => {
    assert.equal(s(applyRainSurge(order, 20).grand_total), "160.00");
  });
});

describe("cash in hand (§15)", () => {
  it("normally equals amount_to_collect", () => {
    assert.equal(s(calculateCashInHandIncrease({ amount_to_collect: 160, grand_total: 160, item_total: 130 })), "160.00");
  });
  it("excludes the rider's own advance when the rider paid at the shop", () => {
    assert.equal(
      s(calculateCashInHandIncrease({ rider_paid_at_shop: true, amount_to_collect: 160, grand_total: 160, item_total: 130 })),
      "30.00"
    );
  });
});

describe("vendor payable (§16)", () => {
  it("COD / UPI: the platform owes the vendor its earning", () => {
    assert.equal(s(calculateVendorAdminPayable({ payment_method: "COD", vendor_earning: 90, vendor_commission: 10 })), "90.00");
  });
  it("prepaid at hotel: the vendor owes the commission (negative)", () => {
    assert.equal(s(calculateVendorAdminPayable({ payment_method: "PREPAID_AT_HOTEL", vendor_earning: 90, vendor_commission: 10 })), "-10.00");
  });
});

describe("full order financials", () => {
  const franchise = { royalty_per_order: 3, is_launch_promo_active: false };
  const zone = { delivery_fee: 30, rider_commission: 20, franchise_profit: 10 };

  it("the four-way split accounts for the whole grand total", () => {
    for (const promo of [false, true]) {
      for (const payment_method of ["COD", "PREPAID_AT_HOTEL", "UPI_TO_ADMIN"]) {
        const f = calculateOrderFinancials({
          item_total: 250,
          zone,
          franchise: { ...franchise, is_launch_promo_active: promo },
          payment_method,
          commission_rate: 10,
          rider_tip: 20,
        });
        const allocated = addMoney(f.vendor_earning, f.rider_earning, f.franchise_profit, f.super_admin_profit);
        assert.equal(s(allocated), s(f.grand_total), `${payment_method} promo=${promo}`);
      }
    }
  });

  it("no partner vendor → no commission or vendor payable", () => {
    const f = calculateOrderFinancials({
      item_total: 80,
      zone,
      franchise,
      payment_method: "COD",
      has_partner_vendor: false,
    });
    assert.equal(s(f.vendor_commission), "0.00");
    assert.equal(s(f.vendor_admin_payable), "0.00");
  });
});
