// The WhatsApp order conversation (SPEC "WhatsApp ordering").
//
// handleInbound() takes one customer message and returns the replies to send.
// It never prices anything itself: totals come from quoteMarketplaceOrder() and
// the order from placeMarketplaceOrder(), the same code the web storefront uses.

import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { addMoney, calculateLineTotal } from "../../utils/orderMath.js";
import { isSellable, effectivePrice, stockLeft } from "../../utils/menu.js";
import { normalizePhone } from "../../utils/phone.js";
import { AppError } from "../../utils/response.js";
import { moneyStr } from "../../utils/serializers.js";
import { saveUpload } from "../../utils/storage.js";
import { istMinutesOfDay } from "../../utils/time.js";
import { cancelOrder } from "../orderCancelService.js";
import { placeMarketplaceOrder, quoteMarketplaceOrder } from "../checkoutService.js";
import { downloadWhatsappMedia } from "./client.js";
import { M, rupees, statusMessage, text } from "./messages.js";

export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const MAX_LINE_QTY = 20;
const MAX_CART_LINES = 20;
const ORDER_WINDOW_MS = 10 * 60 * 1000;
const MAX_ORDERS_PER_WINDOW = 5;
const PAGE = 9; // rows per page when a list needs a "More" row (WhatsApp allows 10)

const trackUrl = (token) => `${env.publicAppUrl}/drop/${token}`;
const reasonOf = (error) =>
  error?.code === "OUTSIDE_DELIVERY_AREA" ? error.message : (error?.details?.[0]?.issue ?? error?.message ?? "something went wrong");

/** Up to 10 rows; longer lists get 9 rows plus a "More…" row. */
function pageRows(items, page, kind, toRow) {
  if (items.length <= 10) return items.map(toRow);
  const rows = items.slice(page * PAGE, page * PAGE + PAGE).map(toRow);
  if ((page + 1) * PAGE < items.length) rows.push({ id: `more:${kind}:${page + 1}`, title: "More… / കൂടുതൽ" });
  return rows;
}

const cartLines = (cart) => cart.map((l) => `• ${l.qty} × ${l.name}`).join("\n");
const cartItemsTotal = (cart) => moneyStr(addMoney("0", ...cart.map((l) => calculateLineTotal(l.price, l.qty))));

// ── Prompts: each one sets the state and queues the message ─────────────────

async function showShops(ctx, page = 0) {
  const vendors = await prisma.vendor.findMany({
    where: { franchise_id: ctx.franchise.id, is_open: true },
    orderBy: { id: "asc" },
    select: { id: true, shop_name: true, min_order_value: true },
  });
  if (vendors.length === 0) {
    ctx.state = "START";
    ctx.say(M.noShops());
    return;
  }
  ctx.state = "SHOP";
  ctx.say(
    M.pickShop(
      pageRows(vendors, page, "shops", (v) => ({
        id: `shop:${v.id}`,
        title: v.shop_name,
        description: `Min ${rupees(v.min_order_value)}`,
      }))
    )
  );
}

async function sellableProducts(ctx) {
  const products = await prisma.product.findMany({
    where: { vendor_id: ctx.data.vendor_id, is_archived: false },
    orderBy: [{ is_combo: "desc" }, { id: "asc" }],
  });
  const minutes = istMinutesOfDay(ctx.now);
  return products.filter((p) => isSellable(p, minutes, ctx.now));
}

async function showItems(ctx, page = 0) {
  if (!ctx.data.vendor_id) return showShops(ctx);
  const products = await sellableProducts(ctx);
  if (products.length === 0) {
    ctx.say(M.noItems());
    return showShops(ctx);
  }
  ctx.state = "ITEMS";
  ctx.say(
    M.pickItem(
      ctx.data.shop_name,
      pageRows(products, page, "items", (p) => {
        const left = stockLeft(p);
        const was = p.offer_price != null && effectivePrice(p, ctx.now).lt(p.price) ? ` (was ${rupees(p.price)})` : "";
        return {
          id: `item:${p.id}`,
          title: p.name,
          description: `${rupees(moneyStr(effectivePrice(p, ctx.now)))}${was}${left ? ` · only ${left} left` : ""}`,
        };
      })
    )
  );
}

function showCart(ctx) {
  if (ctx.data.cart.length === 0) {
    ctx.say(M.cartEmpty());
    return showItems(ctx);
  }
  ctx.state = "CART";
  ctx.say(M.cart(ctx.data.shop_name, cartLines(ctx.data.cart), cartItemsTotal(ctx.data.cart)));
}

function askForLocation(ctx) {
  ctx.state = "LOCATION";
  ctx.say(M.askLocation());
  ctx.say(M.noLocation());
}

async function showConfirm(ctx) {
  // The zone and the delivery fee come from the distance to this pin; no pin, no fee.
  if (ctx.data.lat == null || ctx.data.lng == null) return askForLocation(ctx);
  let quote;
  try {
    quote = await quoteMarketplaceOrder({
      franchise_id: ctx.franchise.id,
      vendor_id: ctx.data.vendor_id,
      drop_lat: ctx.data.lat,
      drop_lng: ctx.data.lng,
      items: ctx.data.cart.map((l) => ({ product_id: l.product_id, quantity: l.qty })),
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    ctx.say(M.failed(reasonOf(error)));
    if (error.code === "OUTSIDE_DELIVERY_AREA") {
      ctx.data.lat = null;
      ctx.data.lng = null;
      return askForLocation(ctx);
    }
    return showCart(ctx);
  }
  const byId = new Map(quote.lines.map((l) => [l.product_id, l]));
  const lines = ctx.data.cart
    .map((l) => `• ${l.qty} × ${l.name} – ${rupees(byId.get(l.product_id)?.line_total ?? "")}`)
    .join("\n");
  ctx.state = "CONFIRM";
  ctx.say(M.confirm({ shop: ctx.data.shop_name, lines, quote, address: ctx.data.address, km: quote.km }));
}

async function reprompt(ctx) {
  switch (ctx.state) {
    case "SHOP": return showShops(ctx);
    case "ITEMS": return showItems(ctx);
    case "QTY": return ctx.data.pending ? ctx.say(M.askQty(ctx.data.pending.name, ctx.data.pending.price)) : showItems(ctx);
    case "QTY_OTHER": return ctx.say(M.typeQty());
    case "CART": return showCart(ctx);
    case "ADDRESS_CONFIRM": return ctx.say(M.savedAddress(ctx.data.saved.address));
    case "ADDRESS_TEXT": return ctx.say(M.askAddress());
    case "LOCATION": return askForLocation(ctx);
    case "CONFIRM": return showConfirm(ctx);
    default: return showShops(ctx);
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function startOver(ctx) {
  ctx.data = { last_order_id: ctx.data.last_order_id };
  return showShops(ctx);
}

async function chooseShop(ctx, id) {
  const vendor = await prisma.vendor.findFirst({ where: { id, franchise_id: ctx.franchise.id } });
  if (!vendor || !vendor.is_open) {
    ctx.say(M.failed(vendor ? `${vendor.shop_name} is closed right now` : "shop not found"));
    return showShops(ctx);
  }
  if (ctx.data.vendor_id !== vendor.id) ctx.data.cart = []; // one shop per order
  ctx.data.vendor_id = vendor.id;
  ctx.data.shop_name = vendor.shop_name;
  ctx.data.cart ??= [];
  return showItems(ctx);
}

async function chooseItem(ctx, id) {
  if (!ctx.data.vendor_id) return showShops(ctx);
  const product = (await sellableProducts(ctx)).find((p) => p.id === id);
  if (!product) {
    ctx.say(M.failed("that item is not available right now"));
    return showItems(ctx);
  }
  ctx.data.pending = { id: product.id, name: product.name, price: moneyStr(effectivePrice(product, ctx.now)) };
  ctx.state = "QTY";
  ctx.say(M.askQty(product.name, ctx.data.pending.price));
}

async function addToCart(ctx, qty) {
  const pending = ctx.data.pending;
  if (!pending) return showItems(ctx);
  const product = (await sellableProducts(ctx)).find((p) => p.id === pending.id);
  if (!product) {
    ctx.say(M.failed("that item is not available right now"));
    return showItems(ctx);
  }
  const cart = ctx.data.cart ?? [];
  const line = cart.find((l) => l.product_id === product.id);
  if (!line && cart.length >= MAX_CART_LINES) {
    ctx.say(M.failed("too many different items in one order"));
    return showCart(ctx);
  }
  let total = Math.min(MAX_LINE_QTY, (line?.qty ?? 0) + qty);
  if (product.stock_qty != null && total > product.stock_qty) {
    total = product.stock_qty;
    ctx.say(M.onlyLeft(product.name, product.stock_qty));
  }
  const entry = { product_id: product.id, name: product.name, price: pending.price, qty: total };
  ctx.data.cart = line ? cart.map((l) => (l === line ? entry : l)) : [...cart, entry];
  ctx.data.pending = null;
  return showCart(ctx);
}

async function afterCart(ctx) {
  const last = await prisma.order.findFirst({
    where: { franchise_id: ctx.franchise.id, customer_phone: ctx.phone, drop_address: { not: null } },
    orderBy: { id: "desc" },
    select: { drop_address: true, turning_point: true },
  });
  if (last) {
    ctx.data.saved = { address: last.drop_address, turning_point: last.turning_point };
    ctx.state = "ADDRESS_CONFIRM";
    ctx.say(M.savedAddress(last.drop_address));
  } else {
    ctx.state = "ADDRESS_TEXT";
    ctx.say(M.askAddress());
  }
}

async function useSavedAddress(ctx) {
  const saved = ctx.data.saved;
  if (!saved) return askNewAddress(ctx);
  ctx.data.address = saved.address;
  ctx.data.landmark = saved.turning_point ?? null;
  // Their house is already known from an earlier delivery: no need to ask again.
  const customer = await prisma.customer.findUnique({
    where: { franchise_id_phone: { franchise_id: ctx.franchise.id, phone: ctx.phone } },
  });
  const verified = customer?.is_location_verified && customer.verified_lat != null;
  const lat = verified ? customer.verified_lat : customer?.lat;
  const lng = verified ? customer.verified_lng : customer?.lng;
  if (lat != null && lng != null) {
    ctx.data.lat = Number(lat);
    ctx.data.lng = Number(lng);
    return showConfirm(ctx);
  }
  return askForLocation(ctx);
}

function askNewAddress(ctx) {
  ctx.state = "ADDRESS_TEXT";
  ctx.say(M.askAddress());
}

/** Cannot share a location: no pin means no delivery fee, so the shop takes the order by phone. */
async function shopHelp(ctx) {
  const vendor = ctx.data.vendor_id
    ? await prisma.vendor.findUnique({ where: { id: ctx.data.vendor_id }, select: { shop_name: true, user: { select: { phone: true } } } })
    : null;
  ctx.say(M.callShop(vendor?.shop_name ?? "the shop", vendor?.user?.phone));
}

async function placeOrder(ctx) {
  const since = new Date(ctx.now.getTime() - ORDER_WINDOW_MS);
  const recent = await prisma.order.count({
    where: { franchise_id: ctx.franchise.id, customer_phone: ctx.phone, created_at: { gte: since } },
  });
  if (recent >= MAX_ORDERS_PER_WINDOW) {
    ctx.say(M.tooMany());
    return;
  }
  const { cart, vendor_id, address } = ctx.data;
  const landmark = ctx.data.landmark ?? null;
  try {
    const { summary } = await placeMarketplaceOrder({
      franchise: ctx.franchise,
      customer_phone: ctx.phone,
      channel: "WHATSAPP",
      body: {
        vendor_id,
        customer_name: ctx.name || undefined,
        drop_address: address,
        turning_point: landmark || undefined,
        payment_method: "COD",
        items: cart.map((l) => ({ product_id: l.product_id, quantity: l.qty })),
        drop_lat: ctx.data.lat,
        drop_lng: ctx.data.lng,
        voice_note_url: ctx.data.voice_url,
      },
    });
    const order = await prisma.order.findFirst({
      where: { franchise_id: ctx.franchise.id, order_number: summary.order_number },
      select: { id: true },
    });
    ctx.data = { last_order_id: order?.id };
    ctx.state = "START";
    ctx.say(M.placed({ order_number: summary.order_number, estimated_total: summary.estimated_total, url: trackUrl(summary.location_token) }));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    ctx.say(M.failed(reasonOf(error)));
    return showCart(ctx);
  }
}

async function latestOrder(ctx) {
  return prisma.order.findFirst({
    where: { franchise_id: ctx.franchise.id, customer_phone: ctx.phone },
    orderBy: { id: "desc" },
  });
}

async function showStatus(ctx) {
  const order = await latestOrder(ctx);
  if (!order) return ctx.say(M.noOrder());
  ctx.say(statusMessage(order, trackUrl(order.location_token)));
}

async function askCancel(ctx) {
  const order = await latestOrder(ctx);
  if (order && ["RIDER_REQUESTED", "RIDER_ASSIGNED", "PICKED_UP", "LOCATION_SHARED"].includes(order.order_status)) {
    return ctx.say(M.askCancel(order.order_number, order.id));
  }
  if (ctx.data.cart?.length) {
    ctx.data.cart = [];
    return ctx.say(M.cartEmpty());
  }
  ctx.say(M.noOrder());
}

async function cancelChosen(ctx, id) {
  const order = await prisma.order.findFirst({
    where: { id, franchise_id: ctx.franchise.id, customer_phone: ctx.phone },
  });
  if (!order) return ctx.say(M.noOrder());
  try {
    await cancelOrder({
      orderId: order.id,
      franchise_id: ctx.franchise.id,
      role: "CUSTOMER",
      reason: "Cancelled by the customer on WhatsApp",
      franchise_slug: ctx.franchise.slug,
    });
    ctx.say(M.cancelled(order.order_number));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    ctx.say(M.cannotCancel(error.message));
  }
}

async function takeVoice(ctx, media_id) {
  const media = await downloadWhatsappMedia(media_id);
  if (!media) return ctx.say(M.askLocation());
  ctx.data.voice_url = await saveUpload(
    { buffer: media.buffer, mimetype: media.mimetype },
    `voice/whatsapp/${ctx.franchise.id}`
  );
  ctx.say(M.gotVoice());
  return askForLocation(ctx);
}

// ── Routing ──────────────────────────────────────────────────────────────────

const GREETING = /^(menu|start|restart|hi|hii|hello|hai|hey|order|നമസ്കാരം|ഹായ്)$/i;

async function route(ctx, message) {
  const word = (message.text ?? "").trim().toLowerCase();

  if (message.type === "text") {
    if (GREETING.test(word)) return startOver(ctx);
    if (word === "status") return showStatus(ctx);
    if (word === "cancel") return askCancel(ctx);
    if (word === "help") return ctx.say(M.help());
  }

  const id = message.id ?? "";
  if (id) {
    const [kind, a, b] = id.split(":");
    const num = Number(a);
    switch (kind) {
      case "shop": return chooseShop(ctx, num);
      case "item": return chooseItem(ctx, num);
      case "qty": {
        if (a === "other") {
          ctx.state = "QTY_OTHER";
          return ctx.say(M.typeQty());
        }
        return addToCart(ctx, num);
      }
      case "cart":
        if (a === "add") return showItems(ctx);
        if (a === "checkout") return ctx.data.cart?.length ? afterCart(ctx) : showShops(ctx);
        if (a === "clear") {
          ctx.data.cart = [];
          return showCart(ctx);
        }
        break;
      case "more": {
        const page = Number(b);
        if (a === "shops") return showShops(ctx, page);
        if (a === "items") return showItems(ctx, page);
        break;
      }
      case "addr": return a === "saved" ? useSavedAddress(ctx) : askNewAddress(ctx);
      case "loc":
        return shopHelp(ctx);
      case "confirm":
        if (a === "yes" && ctx.state === "CONFIRM") return placeOrder(ctx);
        ctx.say(M.cartEmpty());
        ctx.data.cart = [];
        return showShops(ctx);
      case "order":
        if (a === "cancel") return cancelChosen(ctx, Number(b));
        return ctx.say(M.keep());
      default: break;
    }
  }

  if (message.type === "location" && ["LOCATION", "ADDRESS_TEXT", "CONFIRM"].includes(ctx.state)) {
    ctx.data.lat = message.location.lat;
    ctx.data.lng = message.location.lng;
    ctx.say(M.gotLocation());
    return ctx.data.address ? showConfirm(ctx) : askNewAddress(ctx);
  }
  if (message.type === "audio" && ctx.state === "LOCATION") return takeVoice(ctx, message.media_id);

  if (message.type === "text") {
    const raw = message.text.trim();
    if (ctx.state === "START") return startOver(ctx);
    if (ctx.state === "QTY_OTHER") {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_LINE_QTY) return addToCart(ctx, n);
      return ctx.say(M.typeQty());
    }
    if (ctx.state === "ADDRESS_TEXT") {
      if (raw.length < 3) return ctx.say(M.askAddress());
      ctx.data.address = raw.slice(0, 300);
      return askForLocation(ctx);
    }
    if (ctx.state === "LOCATION" && raw.length >= 2) {
      // A landmark helps the rider, but the delivery fee needs the pin.
      ctx.data.landmark = raw.slice(0, 300);
      ctx.say(M.gotLandmark());
      return askForLocation(ctx);
    }
  }

  ctx.say(M.chooseOption());
  return reprompt(ctx);
}

/**
 * One inbound customer message -> the replies to send.
 * `message`: { type: text|button|list|location|audio|other, text?, id?, location?:{lat,lng}, media_id? }
 */
export async function handleInbound({ franchise, wa_id, name, message, now = new Date() }) {
  const phone = normalizePhone(wa_id);
  if (!phone) return [M.notSupported()];

  const stored = await prisma.whatsappSession.findUnique({
    where: { franchise_id_wa_id: { franchise_id: franchise.id, wa_id } },
  });
  const fresh = !stored || now - stored.updated_at > SESSION_IDLE_MS;
  const replies = [];
  const ctx = {
    franchise,
    wa_id,
    phone,
    name,
    now,
    state: fresh ? "START" : stored.state,
    data: fresh ? { last_order_id: stored?.data?.last_order_id } : { ...stored.data },
    say: (reply) => replies.push(reply),
  };

  await route(ctx, message);

  await prisma.whatsappSession.upsert({
    where: { franchise_id_wa_id: { franchise_id: franchise.id, wa_id } },
    create: { franchise_id: franchise.id, wa_id, state: ctx.state, data: ctx.data },
    update: { state: ctx.state, data: ctx.data },
  });
  return replies;
}

export { text };
