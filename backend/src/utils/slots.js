// Product time-slot availability, evaluated in Asia/Kolkata minutes-of-day.

// Default windows per slot. LUNCH_ONLY and DINNER_ONLY hours are not defined
// by the spec — a product's own available_from / available_to ("HH:mm")
// override these when both are set.
const SLOT_WINDOWS = Object.freeze({
  ALL_DAY: null,
  LUNCH_ONLY: [11 * 60, 15 * 60],
  EVENING_SNACKS_3_TO_6: [15 * 60, 18 * 60],
  DINNER_ONLY: [18 * 60, 23 * 60],
});

function parseHHMM(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isProductInSlot(product, minutesOfDay) {
  const from = parseHHMM(product.available_from);
  const to = parseHHMM(product.available_to);
  if (from !== null && to !== null) {
    return from <= to
      ? minutesOfDay >= from && minutesOfDay < to
      : minutesOfDay >= from || minutesOfDay < to; // window crosses midnight
  }
  const window = SLOT_WINDOWS[product.slot_type];
  return !window || (minutesOfDay >= window[0] && minutesOfDay < window[1]);
}

const clock = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
};

/** Human-readable availability window, e.g. "11 AM – 3 PM"; null for all-day products. */
export function slotWindowLabel(product) {
  const from = parseHHMM(product.available_from);
  const to = parseHHMM(product.available_to);
  const window = from !== null && to !== null ? [from, to] : SLOT_WINDOWS[product.slot_type];
  return window ? `${clock(window[0])} – ${clock(window[1])}` : null;
}
