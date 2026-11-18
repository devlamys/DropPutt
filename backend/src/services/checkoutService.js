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
import { dispatchOrder, itemCount, notifyVendorNewOrder } from "./dispatchService.js";
import { MAX_GROUP_SHOPS, allocateGroupFees } from "./groupService.js";

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

  await Promise.all([
    dispatchOrder(order, { franchise_slug: franchise.slug, shop_name: vendor.shop_name }),
    notifyVendorNewOrder(order, vendor, { franchise_slug: franchise.slug }),
  ]);
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


// ─────────────────────────────────────────────────────────────────────────────
// "Deliver together": one checkout, several shops, one rider trip (SPEC "Deliver together").
// Each shop is still its own Order (own items, commission, settlement); the orders share a
// group_id, and the delivery fee of the trip is split between them by allocateGroupFees.
// ─────────────────────────────────────────────────────────────────────────────

export { MAX_GROUP_SHOPS, allocateGroupFees };

async function resolveGroupDeliveries(franchise_id, vendors, drop) {
  return Promise.all(
    vendors.map(async (vendor) =>
      requireDelivery(await resolveDelivery({ franchise_id, from: { lat: vendor.lat, lng: vendor.lng }, to: { lat: drop.lat, lng: drop.lng } }))
    )
  );
}

function checkGroupShops(vendor_ids) {
  const unique = [...new Set(vendor_ids)];
  if (unique.length !== vendor_ids.length) throw fieldError("carts", "each shop can appear once");
  if (unique.length < 2) throw fieldError("carts", "choose at least two shops to deliver together");
  if (unique.length > MAX_GROUP_SHOPS) throw fieldError("carts", `deliver together works for up to ${MAX_GROUP_SHOPS} shops`);
}

/** What delivering these shops together would cost at this pin, against ordering them separately. */
export async function quoteGroupDelivery({ franchise_id, vendor_ids, lat, lng }) {
  checkGroupShops(vendor_ids);
  const vendors = [];
  for (const id of vendor_ids) vendors.push(await loadOpenVendor(franchise_id, id));
  const deliveries = await resolveGroupDeliveries(franchise_id, vendors, { lat, lng });
  const franchise = await prisma.franchise.findUnique({ where: { id: franchise_id }, select: { extra_stop_fee: true } });
  const shares = allocateGroupFees(deliveries.map((d) => ({ zone_fee: d.zone.delivery_fee, km: d.km })), franchise.extra_stop_fee);
  return {
    together_fee: moneyStr(addMoney(...shares)),
    separate_fee: moneyStr(addMoney(...deliveries.map((d) => money(d.zone.delivery_fee)))),
    shops: vendors.map((vendor, i) => ({ vendor_id: vendor.id, shop_name: vendor.shop_name, km: deliveries[i].km, fee: moneyStr(shares[i]) })),
  };
}

/**
 * Creates one order per shop in a single transaction, all sharing a group_id, then calls riders
 * ONCE for the whole trip (the lead order carries the request; accepting any of the group's orders
 * takes them all, see the accept route).
 * `body`: { carts: [{ vendor_id, items }], customer_name?, drop_address, turning_point?, payment_method, drop_lat, drop_lng }
 */
export async function placeGroupOrder({ franchise, body, customer_phone, channel = "WEB" }) {
  const franchise_id = franchise.id;
  const vendor_ids = body.carts.map((cart) => cart.vendor_id);
  checkGroupShops(vendor_ids);
  const vendors = [];
  for (const id of vendor_ids) vendors.push(await loadOpenVendor(franchise_id, id));
  const deliveries = await resolveGroupDeliveries(franchise_id, vendors, { lat: body.drop_lat, lng: body.drop_lng });

  const createOrders = () =>
    prisma.$transaction(async (tx) => {
      const current = await tx.franchise.findUnique({ where: { id: franchise_id } });
      if (!current.wallet_balance.gt(current.min_balance_limit)) {
        throw new AppError(403, "FRANCHISE_WALLET_LOW", "Delivery is temporarily unavailable in this area.");
      }
      const shares = allocateGroupFees(deliveries.map((d) => ({ zone_fee: d.zone.delivery_fee, km: d.km })), current.extra_stop_fee);

      await tx.customer.upsert({
        where: { franchise_id_phone: { franchise_id, phone: customer_phone } },
        create: { franchise_id, phone: customer_phone, name: body.customer_name ?? null, turning_point: body.turning_point ?? null, lat: body.drop_lat, lng: body.drop_lng },
        update: {
          ...(body.customer_name ? { name: body.customer_name } : {}),
          ...(body.turning_point ? { turning_point: body.turning_point } : {}),
          lat: body.drop_lat,
          lng: body.drop_lng,
        },
      });

      const group_id = crypto.randomUUID();
      const datePart = istDayRange().date.replaceAll("-", "").slice(2);
      const orders = [];
      for (let i = 0; i < vendors.length; i += 1) {
        const vendor = vendors[i];
        const cart = await buildCart(tx, vendor, body.carts[i].items, new Date());
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
            zone_id: deliveries[i].zone.id,
            zone_source: "AUTO",
            group_id,
            group_delivery_fee: moneyStr(shares[i]),
            customer_phone,
            customer_name: body.customer_name ?? null,
            pickup_address: vendor.address ?? null,
            pickup_lat: vendor.lat ?? null,
            pickup_lng: vendor.lng ?? null,
            drop_address: body.drop_address,
            drop_lat: body.drop_lat,
            drop_lng: body.drop_lng,
            item_total: moneyStr(cart.item_total),
            items: { create: cart.lines },
          },
          include: { items: { include: { product: { select: { name: true } } } } },
        });
        orders.push({ order, cart, share: shares[i], vendor, delivery: deliveries[i] });
      }
      return { group_id, orders };
    }, TX_OPTIONS);

  let created;
  for (let attempt = 1; ; attempt += 1) {
    try {
      created = await createOrders();
      break;
    } catch (error) {
      const collision = error?.code === "P2002" && String(error.meta?.target).includes("order_number");
      if (!collision || attempt >= 3) throw error;
    }
  }
  const { group_id, orders } = created;

  // One request for the whole trip. The lead is the order carrying the most delivery fee.
  const lead = orders.reduce((best, entry) => (entry.share.gt(best.share) ? entry : best), orders[0]);
  await Promise.all([
    dispatchOrder(lead.order, {
      franchise_slug: franchise.slug,
      shop_name: orders.map((e) => e.vendor.shop_name).join(" + "),
      item_count: orders.reduce((n, e) => n + itemCount(e.order), 0),
      group_size: orders.length,
    }),
    ...orders.map((e) => notifyVendorNewOrder(e.order, e.vendor, { franchise_slug: franchise.slug })),
  ]);
  for (const { order, vendor } of orders) {
    const event = { order_id: order.id, order_status: order.order_status };
    emitTo(rooms.vendor(vendor.id), "order_status_changed", event);
    emitTo(rooms.franchise(franchise_id), "order_status_changed", event);
  }

  const summaries = orders.map(({ order, cart, share, vendor, delivery }) => {
    const total = addMoney(cart.item_total, share);
    return {
      order_number: order.order_number,
      location_token: order.location_token,
      shop_name: vendor.shop_name,
      items: order.items.map((item) => ({ name: item.product.name, quantity: item.quantity, unit_price: moneyStr(item.unit_price), line_total: moneyStr(item.line_total) })),
      item_total: moneyStr(cart.item_total),
      delivery_fee: moneyStr(share),
      distance_km: delivery.km,
      estimated_total: moneyStr(total),
    };
  });
  const grand = addMoney(...orders.map((e) => addMoney(e.cart.item_total, e.share)));
  return {
    group_id,
    orders: summaries,
    delivery_fee: moneyStr(addMoney(...orders.map((e) => e.share))),
    estimated_total: moneyStr(grand),
    payment_method: body.payment_method,
    cash_to_rider: body.payment_method === "UPI_TO_ADMIN" ? "0.00" : moneyStr(grand),
  };
}
