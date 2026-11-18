// /api/v1/marketplace — franchise-scoped feed (SPEC §26, §40).

import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { idempotency } from "../middleware/idempotency.js";
import { customRequestUpload } from "../middleware/upload.js";
import { checkoutIpLimiter, checkoutPhoneLimiter } from "../middleware/rateLimit.js";
import { placeMarketplaceOrder } from "../services/checkoutService.js";
import { deliveryMessage, franchiseCentre, requireDelivery, resolveDelivery } from "../services/deliveryZoneService.js";
import { dispatchOrder } from "../services/dispatchService.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { CHAYAKADI_LABEL, SNACK_MIN_ORDER_VALUE } from "../utils/constants.js";
import { addMoney, money } from "../utils/orderMath.js";
import { normalizePhone } from "../utils/phone.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { AppError, asyncHandler, fieldError, ok } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { saveUpload } from "../utils/storage.js";
import { hasStock, isOfferActive, isSellable, stockLeft } from "../utils/menu.js";
import { slotWindowLabel } from "../utils/slots.js";
import { isChayakadiWindow, istDayRange, istMinutesOfDay } from "../utils/time.js";
import { parse, zId, zLat, zLng } from "../utils/validate.js";

const router = Router();

const CATEGORIES = Object.freeze([
  { key: "FOOD", label: "Food", shop_category: "HOTEL" },
  { key: "EVENING_SNACKS", label: "4 PM Snacks", shop_category: "BAKERY_COOLBAR" },
  { key: "GROCERY", label: "Grocery", shop_category: "GROCERY" },
  { key: "FISH_MEAT", label: "Fish & Meat", shop_category: "FISH_MEAT" },
  { key: "MEDICAL", label: "Medical", shop_category: "MEDICAL_PHARMACY" },
  { key: "CUSTOM_BUY", label: "Buy Anything", shop_category: null },
]);

const feedSchema = z.object({
  // 1 = also list shops that are closed right now (greyed out, nothing orderable).
  include_closed: z.enum(["0", "1"]).optional(),
  shop_category: z
    .enum(["HOTEL", "BAKERY_COOLBAR", "GROCERY", "FISH_MEAT", "MEDICAL_PHARMACY"])
    .optional(),
});

const productView = (product) => ({
  id: product.id,
  vendor_id: product.vendor_id,
  name: product.name,
  price: moneyStr(product.price),
  image_url: product.image_url,
  slot_type: product.slot_type,
  is_combo: product.is_combo,
  // The hotel's own offer: `price` is what the customer pays.
  ...(isOfferActive(product)
    ? {
        price: moneyStr(product.offer_price),
        original_price: moneyStr(product.price),
        offer_label: product.offer_label,
      }
    : {}),
  description: product.description,
  stock_left: stockLeft(product),
});

// GET /api/v1/marketplace/feed?shop_category=&limit=&cursor=
//
// Paginated by vendor. Only open vendors of this franchise and products
// that are available in the current Asia/Kolkata time slot are returned.
router.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const franchise_id = req.franchise_id;
    const { shop_category, include_closed } = parse(feedSchema, req.query);
    const { limit, cursorId } = parsePagination(req.query);

    const now = new Date();
    const minutes = istMinutesOfDay(now);
    const chayakadi = isChayakadiWindow(now);

    const vendors = await prisma.vendor.findMany({
      where: {
        franchise_id,
        ...(include_closed === "1" ? {} : { is_open: true }),
        ...(shop_category ? { shop_category } : {}),
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        shop_name: true,
        shop_category: true,
        address: true,
        lat: true,
        lng: true,
        min_order_value: true,
        is_open: true,
        products: { where: { is_archived: false }, orderBy: [{ is_combo: "desc" }, { id: "asc" }] },
      },
    });
    const page = buildPage(vendors, limit);

    const items = page.items.map((vendor) => {
      // A closed shop is listed only so customers see it exists; nothing in it can be ordered.
      if (!vendor.is_open) {
        return {
          id: vendor.id,
          shop_name: vendor.shop_name,
          shop_category: vendor.shop_category,
          address: vendor.address,
          lat: Number(vendor.lat),
          lng: Number(vendor.lng),
          min_order_value: moneyStr(vendor.min_order_value),
          is_open: false,
          products: [],
          unavailable: [],
        };
      }
      const products = vendor.products.filter(
        (product) => isSellable(product, minutes)
      );
      // Shown greyed-out on the menu ("Sold out" / "Available 11 AM – 3 PM").
      // They are display-only: checkout rejects them.
      const unavailable = vendor.products
        .filter((product) => !products.includes(product))
        .map((product) => ({
          ...productView(product),
          reason: product.is_available && hasStock(product) ? "OUT_OF_SLOT" : "SOLD_OUT",
          available_window: product.is_available && hasStock(product) ? slotWindowLabel(product) : null,
        }));
      // During the window, snack products are listed first.
      if (chayakadi) {
        products.sort(
          (a, b) =>
            Number(b.slot_type === "EVENING_SNACKS_3_TO_6") -
            Number(a.slot_type === "EVENING_SNACKS_3_TO_6")
        );
      }
      return {
        id: vendor.id,
        shop_name: vendor.shop_name,
        shop_category: vendor.shop_category,
        address: vendor.address,
        lat: Number(vendor.lat),
        lng: Number(vendor.lng),
        min_order_value: moneyStr(vendor.min_order_value),
        is_open: true,
        products: products.map(productView),
        unavailable,
      };
    });

    // 15:00–18:00 IST: combos pinned above the normal feed (first page only).
    let pinned = null;
    if (chayakadi && !cursorId) {
      const snacks = await prisma.product.findMany({
        where: {
          is_available: true,
          is_archived: false,
          slot_type: "EVENING_SNACKS_3_TO_6",
          vendor: { franchise_id, is_open: true },
        },
        orderBy: [{ is_combo: "desc" }, { id: "asc" }],
        take: 30,
        include: { vendor: { select: { shop_name: true } } },
      });
      pinned = {
        label: CHAYAKADI_LABEL,
        min_order_value: SNACK_MIN_ORDER_VALUE,
        products: snacks
          .filter((product) => isSellable(product, minutes))
          .map((product) => ({
            ...productView(product),
            shop_name: product.vendor.shop_name,
          })),
      };
    }

    ok(
      res,
      {
        franchise: { name: req.franchise.name, slug: req.franchise.slug },
        is_chayakadi_window: chayakadi,
        // "4 PM Snacks" leads the category row during the window.
        categories: chayakadi
          ? [CATEGORIES[1], CATEGORIES[0], ...CATEGORIES.slice(2)]
          : CATEGORIES,
        pinned,
        items,
      },
      { pagination: page.pagination }
    );
  })
);

// GET /api/v1/marketplace/zones — areas the customer picks at checkout.
router.get(
  "/zones",
  asyncHandler(async (req, res) => {
    const zones = await prisma.zone.findMany({
      where: { franchise_id: req.franchise_id },
      orderBy: [{ max_km: "asc" }, { id: "asc" }],
      select: { id: true, zone_name: true, delivery_fee: true, max_km: true },
    });
    ok(res, {
      zones: zones.map((zone) => ({
        id: zone.id,
        zone_name: zone.zone_name,
        max_km: moneyStr(zone.max_km),
        delivery_fee: moneyStr(zone.delivery_fee),
      })),
    });
  })
);


const checkoutSchema = z.object({
  vendor_id: zId,
  // Where the customer wants it. The zone and the delivery fee come from the
  // distance from the shop to this pin; a client-sent zone is ignored.
  drop_lat: zLat,
  drop_lng: zLng,
  customer_phone: z.union([z.string(), z.number()]),
  customer_name: z.string().trim().min(1).max(100).optional(),
  drop_address: z.string().trim().min(3).max(300),
  // Nearest landmark / where the road turns off: how riders find rural houses.
  turning_point: z.string().trim().min(2).max(300).optional(),
  // What the customer pays with. PREPAID_AT_HOTEL is a shop-side arrangement,
  // never offered to customers.
  payment_method: z.enum(["COD", "UPI_TO_ADMIN"]).default("COD"),
  // Prices and totals are never accepted from the client (SPEC §7).
  items: z
    .array(
      z.object({
        product_id: zId,
        quantity: z.coerce.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(50),
});

// vendor_id is optional: shop-less requests are measured from the town centre.
const quoteSchema = z.object({ vendor_id: zId.optional(), lat: zLat, lng: zLng });

// POST /api/v1/marketplace/delivery-quote — "if I deliver here, what is the fee?" Public.
// The storefront map calls this while the customer moves the pin.
router.post(
  "/delivery-quote",
  checkoutIpLimiter,
  asyncHandler(async (req, res) => {
    const body = parse(quoteSchema, req.body);
    let from;
    if (body.vendor_id) {
      const vendor = await prisma.vendor.findFirst({ where: { id: body.vendor_id, franchise_id: req.franchise_id } });
      if (!vendor) throw fieldError("vendor_id", "shop not found");
      from = { lat: vendor.lat, lng: vendor.lng };
    } else {
      from = await franchiseCentre(req.franchise_id);
      if (!from) throw fieldError("vendor_id", "no shops are set up here yet");
    }
    const result = await resolveDelivery({
      franchise_id: req.franchise_id,
      from,
      to: { lat: body.lat, lng: body.lng },
    });
    ok(res, {
      deliverable: result.deliverable,
      km: result.km,
      zone_name: result.zone?.zone_name ?? null,
      delivery_fee: result.zone ? moneyStr(result.zone.delivery_fee) : null,
      message: result.deliverable ? null : deliveryMessage(result.reason),
    });
  })
);

// POST /api/v1/marketplace/checkout — a customer orders from one shop.
//
// Public (the phone number is the identity, like the Magic Link flow). The
// server loads every product, checks vendor / franchise / availability /
// time slot / minimum order, prices each line itself, then creates the order
// and its OrderItems in one transaction and calls riders. The delivery fee
// shown is the zone's; the rider confirms the final bill at pickup.
router.post(
  "/checkout",
  checkoutIpLimiter,
  checkoutPhoneLimiter,
  idempotency(),
  asyncHandler(async (req, res) => {
    const body = parse(checkoutSchema, req.body);
    const customer_phone = normalizePhone(body.customer_phone);
    if (!customer_phone) throw fieldError("customer_phone", "must be a valid 10-digit mobile number");

    const { summary } = await placeMarketplaceOrder({ franchise: req.franchise, body, customer_phone });
    ok(res, summary, { status: 201 });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/marketplace/orders — "Buy Anything", "Pick & Drop" and "Mini
// Truck" requests from a customer (JSON or multipart). No shop is involved:
// the rider buys (or carries) what the customer describes, and the bill is
// set at pickup.
//
// Buy Anything can carry a checklist (`items`), a photo of a handwritten list
// or prescription (`photo`) and a voice note (`voice`).
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_KINDS = Object.freeze({
  CUSTOM_BUY: { category: "FOOD", label: "Buy Anything" },
  PICK_DROP: { category: "PICK_DROP", label: "Pick & Drop" },
  MINI_TRUCK: { category: "PICK_DROP", label: "Mini Truck" },
});
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// multipart sends `items` as a JSON string; JSON bodies send an array.
const itemsField = z.preprocess((value) => {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value; // fails the array check below with a clear message
  }
}, z.array(z.object({ name: z.string().trim().min(1).max(80), qty: z.coerce.number().int().min(1).max(99) })).max(30));

const customOrderSchema = z
  .object({
    order_type: z.enum(["CUSTOM_BUY", "PICK_DROP", "MINI_TRUCK"]),
    // The customer's pin (current GPS, a searched place or a dragged pin) decides the zone and fee.
    // zone_id is only the fallback for an old client that sends no pin.
    zone_id: zId.optional(),
    drop_lat: zLat.optional(),
    drop_lng: zLng.optional(),
    customer_phone: z.union([z.string(), z.number()]),
    customer_name: z.string().trim().min(1).max(100).optional(),
    drop_address: z.string().trim().min(3).max(300),
    // Buy Anything: the shop to buy from. Pick & Drop / Mini Truck: where to collect.
    pickup_address: z.string().trim().min(3).max(300).optional(),
    shop_name: z.string().trim().min(1).max(150).optional(),
    items: itemsField,
    // Free-text note: what is being carried, or anything extra for a purchase.
    details: z.string().trim().max(1500).optional(),
  })
  .superRefine((body, ctx) => {
    const hasPin = body.drop_lat !== undefined && body.drop_lng !== undefined;
    if (!hasPin && body.zone_id === undefined) {
      ctx.addIssue({ code: "custom", path: ["drop_lat"], message: "required: choose your delivery location" });
    }
    if (body.order_type !== "CUSTOM_BUY") {
      if (!body.pickup_address) {
        ctx.addIssue({ code: "custom", path: ["pickup_address"], message: "required: where should the rider collect it?" });
      }
      if (!body.details || body.details.length < 3) {
        ctx.addIssue({ code: "custom", path: ["details"], message: "required: what is being moved?" });
      }
    }
  });

/** The text the rider reads: the checklist, then the customer's note. */
function requestText({ items, details }) {
  const lines = items.map((item) => `• ${item.qty} × ${item.name}`);
  if (details) lines.push(...(lines.length ? ["", `Note: ${details}`] : [details]));
  return lines.join("\n");
}

router.post(
  "/orders",
  checkoutIpLimiter,
  customRequestUpload, // multipart is parsed first so the per-phone limit can read the body
  checkoutPhoneLimiter,
  idempotency(),
  asyncHandler(async (req, res) => {
    const body = parse(customOrderSchema, req.body);
    const franchise_id = req.franchise_id;
    const kind = ORDER_KINDS[body.order_type];
    const photo = req.files?.photo?.[0];
    const voice = req.files?.voice?.[0];

    const customer_phone = normalizePhone(body.customer_phone);
    if (!customer_phone) throw fieldError("customer_phone", "must be a valid 10-digit mobile number");
    if (photo && photo.size > MAX_PHOTO_BYTES) throw fieldError("photo", "must be 5 MB or smaller");

    const text = requestText(body);
    // A purchase request has to say what to buy, in some form.
    if (body.order_type === "CUSTOM_BUY" && !text && !photo && !voice) {
      throw fieldError("items", "add at least one item, a photo of your list, or a voice note");
    }

    const location_token = crypto.randomBytes(24).toString("base64url");
    // Files are stored only after every check above has passed.
    const folder = `requests/${franchise_id}/${location_token}`;
    const [photoUrl, voiceUrl] = await Promise.all([
      photo ? saveUpload(photo, folder) : null,
      voice ? saveUpload(voice, folder) : null,
    ]);

    const createOrder = () =>
      prisma.$transaction(async (tx) => {
        const franchise = await tx.franchise.findUnique({ where: { id: franchise_id } });
        if (!franchise.wallet_balance.gt(franchise.min_balance_limit)) {
          throw new AppError(403, "FRANCHISE_WALLET_LOW", "Delivery is temporarily unavailable in this area.");
        }
        const hasPin = body.drop_lat !== undefined && body.drop_lng !== undefined;
        let zone;
        if (hasPin) {
          const from = await franchiseCentre(franchise_id, tx);
          if (!from) throw fieldError("drop_lat", "no shops are set up here yet");
          zone = requireDelivery(
            await resolveDelivery({ franchise_id, from, to: { lat: body.drop_lat, lng: body.drop_lng }, db: tx })
          ).zone;
        } else {
          zone = await tx.zone.findFirst({ where: { id: body.zone_id, franchise_id } });
          if (!zone) throw fieldError("zone_id", "area not found");
        }

        await tx.customer.upsert({
          where: { franchise_id_phone: { franchise_id, phone: customer_phone } },
          create: { franchise_id, phone: customer_phone, name: body.customer_name ?? null, ...(hasPin ? { lat: body.drop_lat, lng: body.drop_lng } : {}) },
          update: { ...(body.customer_name ? { name: body.customer_name } : {}), ...(hasPin ? { lat: body.drop_lat, lng: body.drop_lng } : {}) },
        });

        const datePart = istDayRange().date.replaceAll("-", "").slice(2);
        const order = await tx.order.create({
          data: {
            franchise_id,
            order_number: `DP-${datePart}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
            location_token,
            order_type: body.order_type,
            order_category: kind.category,
            order_status: "RIDER_REQUESTED",
            zone_id: zone.id,
            ...(hasPin ? { zone_source: "AUTO", drop_lat: body.drop_lat, drop_lng: body.drop_lng } : {}),
            customer_phone,
            customer_name: body.customer_name ?? null,
            custom_shop_name: body.order_type === "CUSTOM_BUY" ? (body.shop_name ?? null) : null,
            custom_items_text: text || null,
            prescription_img_url: photoUrl,
            request_voice_url: voiceUrl,
            pickup_address: body.pickup_address ?? body.shop_name ?? null,
            drop_address: body.drop_address,
            item_total: "0.00",
          },
        });
        return { order, zone };
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
    const { order, zone } = created;

    await dispatchOrder(order, { franchise_slug: req.franchise.slug, shop_name: body.shop_name ?? kind.label });
    emitTo(rooms.franchise(franchise_id), "order_status_changed", { order_id: order.id, order_status: order.order_status });

    ok(
      res,
      {
        order_number: order.order_number,
        location_token: order.location_token,
        order_type: body.order_type,
        shop_name: body.shop_name ?? kind.label,
        delivery_fee: moneyStr(zone.delivery_fee),
        has_photo: Boolean(photoUrl),
        has_voice_note: Boolean(voiceUrl),
        // The rider confirms the bill (shop purchase / load) at pickup.
        message: "A rider will confirm the final amount before pickup.",
      },
      { status: 201 }
    );
  })
);

export default router;
