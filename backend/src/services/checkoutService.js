// Marketplace checkout shared by the web storefront and the WhatsApp bot
// (SPEC §7). Prices, stock and totals are always decided here, never by the
// caller: the server loads every product, checks vendor / franchise /
// availability / time slot / minimum order, prices each line itself, then
// creates the order and its OrderItems in one transaction and calls riders.

import crypto from "node:crypto";
import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { addMoney, money } from "../utils/orderMath.js";
import { AppError, fieldError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { istDayRange } from "../utils/time.js";
import { buildCart } from "./cartService.js";
import { requireDelivery, resolveDelivery } from "./deliveryZoneService.js";
import { dispatchOrder } from "./dispatchService.js";

export const CATEGORY_BY_SHOP = Object.freeze({
  HOTEL: "FOOD",
  BAKERY_COOLBAR: "EVENING_SNACKS",
  GROCERY: "GROCERY",
  FISH_MEAT: "FISH_MEAT",
  MEDICAL_PHARMACY: "MEDICAL",
});

async function loadOpenVendor(franchise_id, vendor_id) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendor_id, franchise_id } });
  if (!vendor) throw fieldError("vendor_id", "shop not found");
  if (!vendor.is_open) throw fieldError("vendor_id", `${vendor.shop_name} is closed right now`);
  return vendor;
}

/**
 * What this cart would cost right now, without taking any stock: the same
 * validation as checkout, rolled back at the end.
 */
export async function quoteMarketplaceOrder({ franchise_id, vendor_id, drop_lat, drop_lng, items }) {
  const vendor = await loadOpenVendor(franchise_id, vendor_id);
  const delivery = requireDelivery(
    await resolveDelivery({
      franchise_id,
      from: { lat: vendor.lat, lng: vendor.lng },
      to: { lat: drop_lat, lng: drop_lng },
    })
  );
  const zone = delivery.zone;
  const rollback = Symbol("rollback");
  let quote;
  try {
    await prisma.$transaction(async (tx) => {
      const cart = await buildCart(tx, vendor, items, new Date());
      quote = {
        vendor,
        zone,
        km: delivery.km,
        lines: cart.lines,
        item_total: moneyStr(cart.item_total),
        delivery_fee: moneyStr(zone.delivery_fee),
        estimated_total: moneyStr(addMoney(cart.item_total, money(zone.delivery_fee))),
      };
      throw rollback;
    }, TX_OPTIONS);
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return quote;
}

/**
 * Creates the order and calls the riders.
 * `body`: { vendor_id, customer_name?, drop_address, turning_point?, payment_method, items,
 *           drop_lat, drop_lng (required: the zone and fee come from the distance), voice_note_url? }
 */
export async function placeMarketplaceOrder({ franchise, body, customer_phone, channel = "WEB" }) {
  const franchise_id = franchise.id;
  const vendor = await loadOpenVendor(franchise_id, body.vendor_id);
  const hasPin = body.drop_lat != null && body.drop_lng != null;
  if (!hasPin) throw fieldError("drop_lat", "choose the delivery location on the map");
  // The zone is decided here, from the distance: the customer cannot choose it.
  const delivery = requireDelivery(
    await resolveDelivery({
      franchise_id,
      from: { lat: vendor.lat, lng: vendor.lng },
      to: { lat: body.drop_lat, lng: body.drop_lng },
    })
  );

  const createOrder = () =>
    prisma.$transaction(async (tx) => {
      const current = await tx.franchise.findUnique({ where: { id: franchise_id } });
      if (!current.wallet_balance.gt(current.min_balance_limit)) {
        throw new AppError(403, "FRANCHISE_WALLET_LOW", "Delivery is temporarily unavailable in this area.");
      }
      const zone = delivery.zone;

      const cart = await buildCart(tx, vendor, body.items, new Date());

      await tx.customer.upsert({
        where: { franchise_id_phone: { franchise_id, phone: customer_phone } },
        create: {
          franchise_id,
          phone: customer_phone,
          name: body.customer_name ?? null,
          turning_point: body.turning_point ?? null,
          ...(hasPin ? { lat: body.drop_lat, lng: body.drop_lng } : {}),
        },
        update: {
          ...(body.customer_name ? { name: body.customer_name } : {}),
          ...(body.turning_point ? { turning_point: body.turning_point } : {}),
          ...(hasPin ? { lat: body.drop_lat, lng: body.drop_lng } : {}),
        },
      });

      const datePart = istDayRange().date.replaceAll("-", "").slice(2);
      const order = await tx.order.create({
        data: {
          franchise_id,
          order_number: `DP-${datePart}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
          location_token: crypto.randomBytes(24).toString("base64url"),
          payment_method: body.payment_method,
          channel,
          turning_point: body.turning_point ?? null,
          order_type: "FOOD_MARKETPLACE",
          order_category: CATEGORY_BY_SHOP[vendor.shop_category] ?? "FOOD",
          order_status: "RIDER_REQUESTED",
          vendor_id: vendor.id,
          zone_id: zone.id,
          zone_source: "AUTO",
          customer_phone,
          customer_name: body.customer_name ?? null,
          pickup_address: vendor.address ?? null,
          pickup_lat: vendor.lat ?? null,
          pickup_lng: vendor.lng ?? null,
          drop_address: body.drop_address,
          ...(hasPin ? { drop_lat: body.drop_lat, drop_lng: body.drop_lng } : {}),
          voice_note_url: body.voice_note_url ?? null,
          item_total: moneyStr(cart.item_total),
          items: { create: cart.lines },
        },
        include: { items: { include: { product: { select: { name: true } } } } },
      });
      return { order, zone, cart };
    }, TX_OPTIONS);

  let created;
  for (let attempt = 1; ; attempt += 1) {
    try {
      created = await createOrder();
      break;
    } catch (error) {
      const collision = error?.code === "P2002" && String(error.meta?.target).includes("order_number");
      if (!collision || attempt >= 3) throw error;
    }
  }
  const { order, zone, cart } = created;

  await dispatchOrder(order, { franchise_slug: franchise.slug, shop_name: vendor.shop_name });
  // Refresh the shop's and the admin's order boards.
  const event = { order_id: order.id, order_status: order.order_status };
  emitTo(rooms.vendor(vendor.id), "order_status_changed", event);
  emitTo(rooms.franchise(franchise_id), "order_status_changed", event);

  const total = addMoney(cart.item_total, money(zone.delivery_fee));
  return {
    order,
    vendor,
    summary: {
      order_number: order.order_number,
      location_token: order.location_token,
      shop_name: vendor.shop_name,
      items: order.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        unit_price: moneyStr(item.unit_price),
        line_total: moneyStr(item.line_total),
      })),
      item_total: moneyStr(cart.item_total),
      delivery_fee: moneyStr(zone.delivery_fee),
      distance_km: delivery.km,
      estimated_total: moneyStr(total),
      payment_method: order.payment_method,
      // Cash the rider will ask for: nothing when the customer pays by UPI.
      cash_to_rider: order.payment_method === "UPI_TO_ADMIN" ? "0.00" : moneyStr(total),
    },
  };
}
