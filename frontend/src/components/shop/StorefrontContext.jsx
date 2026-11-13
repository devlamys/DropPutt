import { createContext, useContext } from "react";

export const StorefrontContext = createContext(null);
export const useStorefront = () => useContext(StorefrontContext);

const PROFILE_KEY = "dropputt.customer";
const LAST_ORDER_KEY = "dropputt.last_order";
const LAST_ORDER_TTL_MS = 6 * 60 * 60 * 1000;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: fine for this visit */
  }
}

/** Phone, name, address and area remembered on this device for next time. */
export const readProfile = () => read(PROFILE_KEY) || {};
export const saveProfile = (patch) => write(PROFILE_KEY, { ...readProfile(), ...patch });

/** The most recent order, so the customer can get back to its tracking page. */
export function readLastOrder() {
  const order = read(LAST_ORDER_KEY);
  return order && Date.now() - order.at < LAST_ORDER_TTL_MS ? order : null;
}
export const saveLastOrder = (order) => {
  write(LAST_ORDER_KEY, { ...order, at: Date.now() });
  rememberOrder(order);
};

// ── My Orders: every order placed from this device (newest first) ───────────
const ORDERS_KEY = "dropputt.orders";
const ORDERS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ORDERS_MAX = 10;

export function readOrders() {
  const list = read(ORDERS_KEY);
  if (!Array.isArray(list)) return [];
  return list.filter((o) => o?.token && Date.now() - o.at < ORDERS_TTL_MS).slice(0, ORDERS_MAX);
}

/** `order`: { token, number, shop, kind? }. */
export function rememberOrder(order) {
  const rest = readOrders().filter((o) => o.token !== order.token);
  write(ORDERS_KEY, [{ ...order, at: Date.now() }, ...rest].slice(0, ORDERS_MAX));
}

export function forgetOrder(token) {
  write(ORDERS_KEY, readOrders().filter((o) => o.token !== token));
}
