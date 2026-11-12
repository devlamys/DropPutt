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
export const saveLastOrder = (order) => write(LAST_ORDER_KEY, { ...order, at: Date.now() });
