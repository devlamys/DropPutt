import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * Converts a value to a Decimal instance.
 * @param {number|string|Decimal} val
 * @returns {Decimal}
 */
export function toDecimal(val) {
  return new Decimal(val ?? 0);
}

/**
 * Adds two monetary values.
 * @param {number|string|Decimal} a
 * @param {number|string|Decimal} b
 * @returns {Decimal}
 */
export function add(a, b) {
  return toDecimal(a).plus(toDecimal(b));
}

/**
 * Subtracts b from a.
 * @param {number|string|Decimal} a
 * @param {number|string|Decimal} b
 * @returns {Decimal}
 */
export function subtract(a, b) {
  return toDecimal(a).minus(toDecimal(b));
}

/**
 * Multiplies two values.
 * @param {number|string|Decimal} a
 * @param {number|string|Decimal} b
 * @returns {Decimal}
 */
export function multiply(a, b) {
  return toDecimal(a).times(toDecimal(b));
}

/**
 * Divides a by b.
 * @param {number|string|Decimal} a
 * @param {number|string|Decimal} b
 * @returns {Decimal}
 */
export function divide(a, b) {
  return toDecimal(a).dividedBy(toDecimal(b));
}

/**
 * Returns percentage of a value.
 * @param {number|string|Decimal} amount
 * @param {number|string|Decimal} percent
 * @returns {Decimal}
 */
export function percent(amount, percent) {
  return multiply(amount, divide(percent, 100));
}

/**
 * Rounds to 2 decimal places (monetary standard).
 * @param {number|string|Decimal} val
 * @returns {Decimal}
 */
export function round(val) {
  return toDecimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Converts Decimal to a plain string for Prisma storage.
 * @param {Decimal} val
 * @returns {string}
 */
export function toDBString(val) {
  return round(val).toFixed(2);
}

/**
 * Checks if a is greater than b.
 * @param {number|string|Decimal} a
 * @param {number|string|Decimal} b
 * @returns {boolean}
 */
export function gt(a, b) {
  return toDecimal(a).greaterThan(toDecimal(b));
}

/**
 * Checks if a is greater than or equal to b.
 * @param {number|string|Decimal} a
 * @param {number|string|Decimal} b
 * @returns {boolean}
 */
export function gte(a, b) {
  return toDecimal(a).greaterThanOrEqualTo(toDecimal(b));
}

/**
 * Checks if a equals b.
 * @param {number|string|Decimal} a
 * @param {number|string|Decimal} b
 * @returns {boolean}
 */
export function eq(a, b) {
  return toDecimal(a).equals(toDecimal(b));
}
