// /api/v1/marketplace — franchise-scoped feed (SPEC §26, §40).

import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { idempotency } from "../middleware/idempotency.js";
import { customRequestUpload } from "../middleware/upload.js";
import { checkoutIpLimiter, checkoutPhoneLimiter } from "../middleware/rateLimit.js";
import { buildCart, fieldError } from "../services/cartService.js";
import { dispatchOrder } from "../services/dispatchService.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { CHAYAKADI_LABEL, SNACK_MIN_ORDER_VALUE } from "../utils/constants.js";
import { addMoney, money } from "../utils/orderMath.js";
import { normalizePhone } from "../utils/phone.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { AppError, asyncHandler, ok } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { saveUpload } from "../utils/storage.js";
import { isProductInSlot, slotWindowLabel } from "../utils/slots.js";
import { isChayakadiWindow, istDayRange, istMinutesOfDay } from "../utils/time.js";
import { parse, zId } from "../utils/validate.js";

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
});

// GET /api/v1/marketplace/feed?shop_category=&limit=&cursor=
//
// Paginated by vendor. Only open vendors of this franchise and products
// that are available in the current Asia/Kolkata time slot are returned.
router.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const franchise_id = req.franchise_id;
    const { shop_category } = parse(feedSchema, req.query);
    const { limit, cursorId } = parsePagination(req.query);

    const now = new Date();
    const minutes = istMinutesOfDay(now);
    const chayakadi = isChayakadiWindow(now);

    const vendors = await prisma.vendor.findMany({
      where: {
        franchise_id,
        is_open: true,
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
        min_order_value: true,
        products: { orderBy: [{ is_combo: "desc" }, { id: "asc" }] },
      },
    });
    const page = buildPage(vendors, limit);

    const items = page.items.map((vendor) => {
      const products = vendor.products.filter(
        (product) => product.is_available && isProductInSlot(product, minutes)
      );
      // Shown greyed-out on the menu ("Sold out" / "Available 11 AM – 3 PM").
      // They are display-only: checkout rejects them.
      const unavailable = vendor.products
        .filter((product) => !products.includes(product))
        .map((product) => ({
          ...productView(product),
          reason: product.is_available ? "OUT_OF_SLOT" : "SOLD_OUT",
          available_window: product.is_available ? slotWindowLabel(product) : null,
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
        min_order_value: moneyStr(vendor.min_order_value),
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
          .filter((product) => isProductInSlot(product, minutes))
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
      orderBy: { delivery_fee: "asc" },
      select: { id: true, zone_name: true, delivery_fee: true },
    });
    ok(res, {
      zones: zones.map((zone) => ({
        id: zone.id,
        zone_name: zone.zone_name,
        delivery_fee: moneyStr(zone.delivery_fee),
      })),
    });
  })
);

const CATEGORY_BY_SHOP = Object.freeze({
  HOTEL: "FOOD",
  BAKERY_COOLBAR: "EVENING_SNACKS",
  GROCERY: "GROCERY",
  FISH_MEAT: "FISH_MEAT",
  MEDICAL_PHARMACY: "MEDICAL",
});

const checkoutSchema = z.object({
  vendor_id: zId,
  zone_id: zId,
  customer_phone: z.union([z.string(), z.number()]),
  customer_name: z.string().trim().min(1).max(100).optional(),
  drop_address: z.string().trim().min(3).max(300),
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
    const franchise_id = req.franchise_id;

    const customer_phone = normalizePhone(body.customer_phone);
    if (!customer_phone) throw fieldError("customer_phone", "must be a valid 10-digit mobile number");

    const vendor = await prisma.vendor.findFirst({
      where: { id: body.vendor_id, franchise_id },
    });
    if (!vendor) throw fieldError("vendor_id", "shop not found");
    if (!vendor.is_open) throw fieldError("vendor_id", `${vendor.shop_name} is closed right now`);

    const createOrder = () =>
      prisma.$transaction(async (tx) => {
        const franchise = await tx.franchise.findUnique({ where: { id: franchise_id } });
        if (!franchise.wallet_balance.gt(franchise.min_balance_limit)) {
          throw new AppError(
            403,
            "FRANCHISE_WALLET_LOW",
            "Delivery is temporarily unavailable in this area."
          );
        }
        const zone = await tx.zone.findFirst({ where: { id: body.zone_id, franchise_id } });
        if (!zone) throw fieldError("zone_id", "area not found");

        const cart = await buildCart(tx, vendor, body.items, new Date());

        await tx.customer.upsert({
          where: { franchise_id_phone: { franchise_id, phone: customer_phone } },
          create: { franchise_id, phone: customer_phone, name: body.customer_name ?? null },
          update: body.customer_name ? { name: body.customer_name } : {},
        });

        const datePart = istDayRange().date.replaceAll("-", "").slice(2);
        const order = await tx.order.create({
          data: {
            franchise_id,
            order_number: `DP-${datePart}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
            location_token: crypto.randomBytes(24).toString("base64url"),
            order_type: "FOOD_MARKETPLACE",
            order_category: CATEGORY_BY_SHOP[vendor.shop_category] ?? "FOOD",
            order_status: "RIDER_REQUESTED",
            vendor_id: vendor.id,
            zone_id: zone.id,
            customer_phone,
            customer_name: body.customer_name ?? null,
            pickup_address: vendor.address ?? null,
            pickup_lat: vendor.lat ?? null,
            pickup_lng: vendor.lng ?? null,
            drop_address: body.drop_address,
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
        const collision =
          error?.code === "P2002" && String(error.meta?.target).includes("order_number");
        if (!collision || attempt >= 3) throw error;
      }
    }
    const { order, zone, cart } = created;

    await dispatchOrder(order, {
      franchise_slug: req.franchise.slug,
      shop_name: vendor.shop_name,
    });
    // Refresh the shop's and the admin's order boards.
    const event = { order_id: order.id, order_status: order.order_status };
    emitTo(rooms.vendor(vendor.id), "order_status_changed", event);
    emitTo(rooms.franchise(franchise_id), "order_status_changed", event);

    ok(
      res,
      {
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
        estimated_total: moneyStr(addMoney(cart.item_total, money(zone.delivery_fee))),
      },
      { status: 201 }
    );
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
    zone_id: zId,
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
        const zone = await tx.zone.findFirst({ where: { id: body.zone_id, franchise_id } });
        if (!zone) throw fieldError("zone_id", "area not found");

        await tx.customer.upsert({
          where: { franchise_id_phone: { franchise_id, phone: customer_phone } },
          create: { franchise_id, phone: customer_phone, name: body.customer_name ?? null },
          update: body.customer_name ? { name: body.customer_name } : {},
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
