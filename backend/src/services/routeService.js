// Road route from the rider to the customer's drop point, for the live maps.
//
// Uses any OSRM-compatible server (ROUTING_URL). Without it the feature is off
// and the maps fall back to a straight dashed line — nothing else changes.
//
//   Production: self-host OSRM on a Kerala/South-India OSM extract.
//   Development: https://router.project-osrm.org works, but it is a shared
//   demo server with no capacity guarantees — never point production at it.
//
// A route is fetched only when it is needed, never on every GPS ping:
//   • the order has no route yet, or the drop point changed (customer re-pinned);
//   • the rider has left the route by more than OFF_ROUTE_METRES.
// …and at most once per MIN_REFRESH_MS per order, claimed in the database so
// several API replicas do not all call the router.
//
// Every failure is swallowed: a broken router must never slow down or break
// location updates.

import { prisma } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";

const IN_DELIVERY = ["PICKED_UP", "LOCATION_SHARED"];
const OFF_ROUTE_METRES = 80;
const MIN_REFRESH_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 4000;
const MAX_POINTS = 400; // enough detail for a village road, small enough for 2G
const CACHE_MAX = 2000;

/** orderId → { route, dest_key } — avoids a DB read on every 5-second ping. */
const cache = new Map();

const routingUrl = () => (process.env.ROUTING_URL || "").trim().replace(/\/+$/, "");
export const routingEnabled = () => Boolean(routingUrl());

const destKey = (lat, lng) => `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;

// ── geometry ────────────────────────────────────────────────────────────────

const toRad = (deg) => (deg * Math.PI) / 180;

/** Metres between two [lat, lng] points (equirectangular — fine below ~50 km). */
export function metresBetween([lat1, lng1], [lat2, lng2]) {
  const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Shortest distance in metres from point p to the segment a–b. */
function metresToSegment(p, a, b) {
  // Project onto a local flat plane centred on p.
  const k = Math.cos(toRad(p[0]));
  const ax = (a[1] - p[1]) * k, ay = a[0] - p[0];
  const bx = (b[1] - p[1]) * k, by = b[0] - p[0];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy) * (Math.PI / 180) * 6_371_000;
}

/** Distance in metres from p to the nearest part of the polyline. */
export function metresFromRoute(p, coords) {
  if (!coords?.length) return Infinity;
  if (coords.length === 1) return metresBetween(p, coords[0]);
  let best = Infinity;
  for (let i = 1; i < coords.length; i += 1) {
    best = Math.min(best, metresToSegment(p, coords[i - 1], coords[i]));
  }
  return best;
}

/** Keeps the first and last point and thins the rest evenly. */
function thin(coords) {
  if (coords.length <= MAX_POINTS) return coords;
  const step = (coords.length - 1) / (MAX_POINTS - 1);
  const out = [];
  for (let i = 0; i < MAX_POINTS - 1; i += 1) out.push(coords[Math.round(i * step)]);
  out.push(coords[coords.length - 1]);
  return out;
}

// ── router ──────────────────────────────────────────────────────────────────

/**
 * Asks the router for a driving route. Returns
 * { coords: [[lat,lng]...], distance_m, duration_s } or null.
 */
export async function fetchRoute(from, to) {
  const base = routingUrl();
  if (!base) return null;
  const path = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `${base}/route/v1/driving/${path}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "user-agent": "DropPutt-routing/1.0" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const route = body?.code === "Ok" ? body.routes?.[0] : null;
    const line = route?.geometry?.coordinates;
    if (!Array.isArray(line) || line.length < 2) return null;
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng]. 6 decimals ≈ 0.1 m.
    const coords = thin(
      line.map(([lng, lat]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))])
    );
    return {
      coords,
      distance_m: Math.round(route.distance),
      duration_s: Math.round(route.duration),
    };
  } catch {
    return null; // timeout, DNS, bad JSON… the map just keeps the straight line
  }
}

// ── per-order refresh ───────────────────────────────────────────────────────

function remember(orderId, value) {
  if (cache.size >= CACHE_MAX && !cache.has(orderId)) cache.delete(cache.keys().next().value);
  cache.set(orderId, value);
}

export function forgetRoute(orderId) {
  cache.delete(orderId);
}

/** Tests only: their database restarts ids, so cached orders must be dropped. */
export function clearRouteCache() {
  cache.clear();
}

/** Customer/rider-safe view of a stored route. */
export function routeView(order) {
  const route = order?.route;
  if (!route?.coords?.length || !IN_DELIVERY.includes(order.order_status)) return null;
  return {
    coords: route.coords,
    distance_m: route.distance_m,
    duration_s: route.duration_s,
    updated_at: order.route_updated_at ?? null,
  };
}

/**
 * Called after a rider position is applied. Cheap when nothing is due:
 * one in-memory lookup and a polyline distance check.
 *
 * @param {number} orderId
 * @param {[number, number]} position  rider [lat, lng]
 * @param {{ force?: boolean }} [opts]  force: drop point just changed
 */
export async function maybeRefreshRoute(orderId, position, { force = false } = {}) {
  if (!routingEnabled()) return null;
  try {
    let entry = cache.get(orderId);
    if (!entry || force) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { order_status: true, drop_lat: true, drop_lng: true, route: true },
      });
      if (!order || !IN_DELIVERY.includes(order.order_status) || order.drop_lat === null) {
        forgetRoute(orderId);
        return null;
      }
      entry = {
        route: order.route,
        dest_key: destKey(order.drop_lat, order.drop_lng),
        dest: [Number(order.drop_lat), Number(order.drop_lng)],
      };
      remember(orderId, entry);
    }

    const stale =
      force ||
      !entry.route?.coords?.length ||
      entry.route.dest_key !== entry.dest_key ||
      metresFromRoute(position, entry.route.coords) > OFF_ROUTE_METRES;
    if (!stale) return null;

    // Claim the refresh (throttle + one replica only).
    const now = new Date();
    const claimed = await prisma.order.updateMany({
      where: {
        id: orderId,
        order_status: { in: IN_DELIVERY },
        OR: [
          { route_updated_at: null },
          { route_updated_at: { lt: new Date(now.getTime() - MIN_REFRESH_MS) } },
        ],
      },
      data: { route_updated_at: now },
    });
    if (claimed.count === 0) return null;

    const fresh = await fetchRoute(position, entry.dest);
    if (!fresh) return null;

    const route = { ...fresh, dest: entry.dest, dest_key: entry.dest_key };
    const saved = await prisma.order.updateMany({
      where: { id: orderId, order_status: { in: IN_DELIVERY } },
      data: { route },
    });
    if (saved.count === 0) {
      forgetRoute(orderId); // delivered or cancelled while we were asking
      return null;
    }
    remember(orderId, { ...entry, route });

    const view = routeView({ route, order_status: "PICKED_UP", route_updated_at: now });
    emitTo(rooms.order(orderId), "route_updated", { order_id: orderId, ...view });
    return view;
  } catch (error) {
    console.error("[route] refresh failed for order", orderId, error.message);
    return null;
  }
}

/**
 * Recompute from the rider's last known position — used when the drop point
 * changes (pickup copied a verified gate, or the customer shared a pin).
 * Fire-and-forget.
 */
export function refreshRouteFromRider(orderId) {
  if (!routingEnabled()) return;
  void (async () => {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { rider: { select: { current_lat: true, current_lng: true } } },
      });
      const r = order?.rider;
      if (r?.current_lat == null || r?.current_lng == null) return;
      await maybeRefreshRoute(orderId, [Number(r.current_lat), Number(r.current_lng)], { force: true });
    } catch (error) {
      console.error("[route] refresh from rider failed for order", orderId, error.message);
    }
  })();
}
