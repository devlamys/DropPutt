// Delivery zone and fee from distance (SPEC "Delivery zones by distance").
//
// The customer never picks a zone. The distance from the hotel to the
// customer's pin decides it, so the same rule applies on the storefront, on
// WhatsApp and for Call Rider Now.

import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/response.js";
import { haversineMetres, isLatLng } from "../utils/geo.js";
import { fetchRoadDistance, routingEnabled } from "./routeService.js";

/** Roads wind: with no router, a straight line is stretched by this much. */
export const STRAIGHT_LINE_FACTOR = 1.3;

/** Distance in km (one decimal) between two {lat, lng} points, and how it was measured. */
export async function distanceKm(from, to) {
  const a = [Number(from.lat), Number(from.lng)];
  const b = [Number(to.lat), Number(to.lng)];
  if (routingEnabled()) {
    const road = await fetchRoadDistance(a, b);
    if (road !== null) return { km: Math.round(road / 100) / 10, method: "ROAD" };
  }
  return { km: Math.round((haversineMetres(a, b) * STRAIGHT_LINE_FACTOR) / 100) / 10, method: "STRAIGHT" };
}

/**
 * Picks the franchise's distance band for the hotel -> customer trip.
 * Returns { km, method, zone, deliverable, reason }. Never throws for "too far":
 * callers decide (see requireDelivery).
 */
export async function resolveDelivery({ franchise_id, from, to, db = prisma }) {
  if (!isLatLng(from?.lat, from?.lng) || !isLatLng(to?.lat, to?.lng)) {
    return { km: null, method: null, zone: null, deliverable: false, reason: "INVALID_LOCATION" };
  }
  const [franchise, zones] = await Promise.all([
    db.franchise.findUnique({ where: { id: franchise_id }, select: { max_delivery_km: true } }),
    db.zone.findMany({ where: { franchise_id }, orderBy: [{ max_km: "asc" }, { id: "asc" }] }),
  ]);
  const { km, method } = await distanceKm(from, to);
  if (zones.length === 0) return { km, method, zone: null, deliverable: false, reason: "NO_ZONES" };
  if (km > Number(franchise.max_delivery_km)) return { km, method, zone: null, deliverable: false, reason: "TOO_FAR" };
  // First band that reaches this far; past the last band but within the limit, the last band.
  const zone = zones.find((z) => km <= Number(z.max_km)) ?? zones[zones.length - 1];
  return { km, method, zone, deliverable: true, reason: null };
}

const MESSAGES = {
  INVALID_LOCATION: "Please choose a valid delivery location",
  NO_ZONES: "Delivery areas are not set up yet",
  TOO_FAR: "This location is outside our delivery area",
};

/** Throws a 422 OUTSIDE_DELIVERY_AREA (or validation-style error) unless the trip is deliverable. */
export function requireDelivery(result) {
  if (result.deliverable) return result;
  throw new AppError(422, "OUTSIDE_DELIVERY_AREA", MESSAGES[result.reason] ?? MESSAGES.TOO_FAR, [
    { field: "drop_lat", issue: result.reason?.toLowerCase() ?? "too_far" },
  ]);
}

export const deliveryMessage = (reason) => MESSAGES[reason] ?? MESSAGES.TOO_FAR;

const pointOf = (lat, lng) => (lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null);

/**
 * Call Rider Now has no pin when the hotel makes the call. At pickup the
 * customer's location may be known: the pin they shared on their Magic Link,
 * the rider-verified gate of an earlier delivery, or their last saved pin.
 * Returns the resolved delivery, or null when the location is unknown (the
 * rider then picks the zone, as before) or too far to be a normal band.
 */
export async function autoZoneForOrder({ franchise_id, order, customer_phone, db = prisma }) {
  const from = pointOf(order.pickup_lat, order.pickup_lng);
  if (!from) return null;
  let to = pointOf(order.drop_lat, order.drop_lng);
  const phone = customer_phone ?? order.customer_phone;
  if (!to && phone) {
    const customer = await db.customer.findUnique({ where: { franchise_id_phone: { franchise_id, phone } } });
    if (customer) {
      to =
        (customer.is_location_verified && pointOf(customer.verified_lat, customer.verified_lng)) ||
        pointOf(customer.lat, customer.lng);
    }
  }
  if (!to) return null;
  const result = await resolveDelivery({ franchise_id, from, to, db });
  return result.deliverable ? result : null;
}

/**
 * After delivery: was the rider's gate in the band the customer was charged for?
 * Only for the audit trail: the fee a customer was quoted is never changed.
 */
export async function zoneAtGate({ franchise_id, order, gate }) {
  const from = pointOf(order.pickup_lat, order.pickup_lng);
  const to = pointOf(gate?.lat, gate?.lng);
  if (!from || !to) return null;
  const result = await resolveDelivery({ franchise_id, from, to });
  return result.zone ? { zone_id: result.zone.id, km: result.km } : { zone_id: null, km: result.km };
}
