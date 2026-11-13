// Helpers for the road route the server sends: { coords: [[lat,lng]...], distance_m, duration_s }.

const toRad = (deg) => (deg * Math.PI) / 180;

/** Metres between two [lat, lng] points (equirectangular — fine for town distances). */
export function metresBetween(a, b) {
  const x = toRad(b[1] - a[1]) * Math.cos(toRad((a[0] + b[0]) / 2));
  const y = toRad(b[0] - a[0]);
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Closest point on segment a–b to p, as [lat, lng], plus its distance in metres. */
function closestOnSegment(p, a, b) {
  const k = Math.cos(toRad(p[0]));
  const ax = (a[1] - p[1]) * k, ay = a[0] - p[0];
  const dx = (b[1] - a[1]) * k, dy = b[0] - a[0];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { point, metres: metresBetween(p, point) };
}

/**
 * The part of the route still ahead of `position`: the rider's spot snapped onto
 * the road, then every later vertex. Returns { coords, metres, offRoute } —
 * `metres` is the road distance left; `offRoute` is how far the rider is from the road.
 */
export function remainingRoute(route, position) {
  const coords = route?.coords;
  if (!coords?.length) return null;
  if (!position || coords.length < 2) {
    return { coords, metres: route.distance_m ?? 0, offRoute: 0 };
  }

  let best = { index: 0, point: coords[0], metres: Infinity };
  for (let i = 1; i < coords.length; i += 1) {
    const hit = closestOnSegment(position, coords[i - 1], coords[i]);
    if (hit.metres < best.metres) best = { index: i, point: hit.point, metres: hit.metres };
  }

  const ahead = [best.point, ...coords.slice(best.index)];
  let metres = 0;
  for (let i = 1; i < ahead.length; i += 1) metres += metresBetween(ahead[i - 1], ahead[i]);
  return { coords: ahead, metres, offRoute: best.metres };
}

/** Minutes left, scaled from the router's own speed for this route. Never below 1. */
export function etaMinutes(route, metresLeft) {
  if (!route?.distance_m || !route?.duration_s) return null;
  const share = Math.min(1, Math.max(0, metresLeft / route.distance_m));
  return Math.max(1, Math.ceil((route.duration_s * share) / 60));
}

export function formatDistance(metres) {
  if (metres == null) return "";
  return metres < 1000 ? `${Math.max(10, Math.round(metres / 10) * 10)} m` : `${(metres / 1000).toFixed(1)} km`;
}

// Map styling shared by the customer and rider maps.
export const ROUTE_STYLE = {
  casing: { color: "#ffffff", weight: 9, opacity: 0.95, lineCap: "round", lineJoin: "round" },
  line: { color: "#ea580c", weight: 5, opacity: 1, lineCap: "round", lineJoin: "round" },
  // Thin moving dashes on top show the direction of travel (animated in index.css).
  flow: { color: "#fff7ed", weight: 2, opacity: 0.9, dashArray: "2 12", className: "dp-route-flow" },
  // Last stretch from the end of the road to the gate, and the no-route fallback.
  walk: { color: "#64748b", weight: 3, opacity: 0.9, dashArray: "4 8" },
  straight: { color: "#ea580c", weight: 4, dashArray: "8 8" },
};

// A road that stops this far or more from the gate gets the dashed "walk" leg.
export const GATE_GAP_METRES = 15;
