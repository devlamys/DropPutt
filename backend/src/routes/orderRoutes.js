// /api/v1/orders — quick-call, accept, rider-pickup, deliver.
//
// Every query is scoped by req.franchise_id. Money-changing work runs inside
// prisma.$transaction with explicit FOR UPDATE row locks, always taken in
// the order: Order -> Rider -> Vendor -> Franchise (SPEC §35).

import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { authenticate, loadRider, requireRole } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { billImageUpload, gatePhotoUpload } from "../middleware/upload.js";
import { buildCart } from "../services/cartService.js";
import { dispatchOrder } from "../services/dispatchService.js";
import { cancelOrder } from "../services/orderCancelService.js";
import { emitTo, joinRiderToOrder, rooms } from "../socket/socketHandler.js";
import { audit } from "../utils/audit.js";
import {
  ACTIVE_ORDER_STATUSES,
} from "../utils/constants.js";
import {
  addMoney,
  calculateCashInHandIncrease,
  calculateLineTotal,
  calculateOrderFinancials,
  money,
  subtractMoney,
} from "../utils/orderMath.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { normalizePhone } from "../utils/phone.js";
import { pushToUsers } from "../utils/push.js";
import {
  AppError,
  asyncHandler,
  fieldError,
  forbidden,
  ok,
  orderNotFound,
  validationError,
} from "../utils/response.js";
import { moneyStr, orderView } from "../utils/serializers.js";
import { saveUpload } from "../utils/storage.js";
import { istDayRange } from "../utils/time.js";
import { parse, parseId, zBoolean, zId, zLat, zLng, zMoney } from "../utils/validate.js";

const router = Router();
router.use(authenticate);

const CATEGORY_BY_SHOP = Object.freeze({
  HOTEL: "FOOD",
  BAKERY_COOLBAR: "EVENING_SNACKS",
  GROCERY: "GROCERY",
  FISH_MEAT: "FISH_MEAT",
  MEDICAL_PHARMACY: "MEDICAL",
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/orders/quick-call — a vendor (or franchise admin) calls a rider
// ─────────────────────────────────────────────────────────────────────────────

const quickCallSchema = z.object({
  vendor_id: zId.optional(), // admin only
  order_type: z.enum(["CUSTOM_BUY", "PICK_DROP", "MINI_TRUCK"]).optional(),
  order_category: z
    .enum(["FOOD", "EVENING_SNACKS", "GROCERY", "FISH_MEAT", "MEDICAL", "PICK_DROP"])
    .optional(),
  zone_id: zId.optional(),
  customer_phone: z.union([z.string(), z.number()]).optional(),
  customer_name: z.string().trim().min(1).max(100).optional(),
  custom_shop_name: z.string().trim().min(1).max(150).optional(),
  custom_items_text: z.string().trim().min(1).max(2000).optional(),
  pickup_address: z.string().trim().min(1).max(300).optional(),
  drop_address: z.string().trim().min(1).max(300).optional(),
  // Optional itemized cart (SPEC §7). Line totals are never accepted.
  items: z
    .array(
      z.object({
        product_id: zId,
        quantity: z.coerce.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(50)
    .optional(),
});


router.post(
  "/quick-call",
  requireRole("VENDOR", "FRANCHISE_ADMIN"),
  idempotency(),
  asyncHandler(async (req, res) => {
    const body = parse(quickCallSchema, req.body);
    const franchise_id = req.franchise_id;

    let vendor = null;
    if (req.user.role === "VENDOR") {
      vendor = await prisma.vendor.findFirst({
        where: { user_id: req.user.id, franchise_id },
      });
      if (!vendor) throw forbidden("Vendor profile not found in this franchise");
    } else if (body.vendor_id) {
      vendor = await prisma.vendor.findFirst({
        where: { id: body.vendor_id, franchise_id },
      });
      if (!vendor) throw fieldError("vendor_id", "vendor not found in this franchise");
    }

    let customer_phone = null;
    if (body.customer_phone !== undefined) {
      customer_phone = normalizePhone(body.customer_phone);
      if (!customer_phone) {
        throw fieldError("customer_phone", "must be a valid 10-digit mobile number");
      }
    }
    if (body.items && !vendor) throw fieldError("items", "items require a partner vendor");

    let order_type;
    if (vendor) {
      order_type = body.items ? "FOOD_MARKETPLACE" : "HOTEL_DIRECT";
    } else {
      order_type = body.order_type;
      if (!order_type) throw fieldError("order_type", "required when there is no vendor");
      if (order_type === "CUSTOM_BUY" && !body.custom_items_text) {
        throw fieldError("custom_items_text", "required for CUSTOM_BUY");
      }
    }
    const order_category =
      body.order_category ??
      (vendor
        ? CATEGORY_BY_SHOP[vendor.shop_category]
        : order_type === "CUSTOM_BUY"
          ? "FOOD"
          : "PICK_DROP");

    const createOrder = () =>
      prisma.$transaction(async (tx) => {
        // Step 1 — royalty wallet gate.
        const franchise = await tx.franchise.findUnique({ where: { id: franchise_id } });
        if (!franchise.wallet_balance.gt(franchise.min_balance_limit)) {
          throw new AppError(
            403,
            "FRANCHISE_WALLET_LOW",
            "Franchise wallet balance low. Please recharge."
          );
        }

        if (body.zone_id) {
          const zone = await tx.zone.findFirst({
            where: { id: body.zone_id, franchise_id },
            select: { id: true },
          });
          if (!zone) throw fieldError("zone_id", "zone not found in this franchise");
        }

        const cart = body.items ? await buildCart(tx, vendor, body.items, new Date()) : null;

        // Step 2 — create the order with an opaque Magic Link token.
        const datePart = istDayRange().date.replaceAll("-", "").slice(2);
        return tx.order.create({
          data: {
            franchise_id,
            order_number: `DP-${datePart}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
            location_token: crypto.randomBytes(24).toString("base64url"),
            order_type,
            order_category,
            order_status: "RIDER_REQUESTED",
            vendor_id: vendor?.id ?? null,
            zone_id: body.zone_id ?? null,
            customer_phone,
            customer_name: body.customer_name ?? null,
            custom_shop_name: vendor ? null : (body.custom_shop_name ?? null),
            custom_items_text: body.custom_items_text ?? null,
            pickup_address: body.pickup_address ?? vendor?.address ?? null,
            pickup_lat: vendor?.lat ?? null,
            pickup_lng: vendor?.lng ?? null,
            drop_address: body.drop_address ?? null,
            item_total: cart ? moneyStr(cart.item_total) : "0.00",
            items: cart ? { create: cart.lines } : undefined,
          },
          include: { items: true },
        });
      }, TX_OPTIONS);

    // order_number is unique per franchise; retry on the rare collision.
    let order;
    for (let attempt = 1; ; attempt += 1) {
      try {
        order = await createOrder();
        break;
      } catch (error) {
        const collision =
          error?.code === "P2002" && String(error.meta?.target).includes("order_number");
        if (!collision || attempt >= 3) throw error;
      }
    }

    // Step 3 — rider dispatch (after commit).
    const dispatch = await dispatchOrder(order, {
      franchise_slug: req.franchise.slug,
      shop_name: vendor?.shop_name,
    });

    ok(
      res,
      {
        order: {
          ...orderView(order),
          items: order.items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: moneyStr(item.unit_price),
            line_total: moneyStr(item.line_total),
          })),
        },
        dispatch,
      },
      { status: 201 }
    );
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/orders/:id/accept — atomic rider acceptance (row lock)
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  "/:id/accept",
  requireRole("RIDER"),
  loadRider,
  asyncHandler(async (req, res) => {
    const orderId = parseId(req.params.id);
    const franchiseId = req.franchise_id;

    const order = await prisma.$transaction(async (tx) => {
      // Lock the order row. A concurrent accept blocks here and, once the
      // winner commits, finds the status changed and gets no row back.
      const rows = await tx.$queryRaw`
        SELECT id, order_status
        FROM "orders"
        WHERE id = ${orderId}
          AND franchise_id = ${franchiseId}
          AND order_status = 'RIDER_REQUESTED'
        FOR UPDATE
      `;
      if (rows.length === 0) {
        const exists = await tx.order.findFirst({
          where: { id: orderId, franchise_id: franchiseId },
          select: { id: true },
        });
        if (!exists) throw orderNotFound();
        throw new AppError(
          409,
          "ORDER_ALREADY_ACCEPTED",
          "This order is no longer available"
        );
      }

      // Lock the rider so two accepts by the same rider cannot both pass
      // the cash and active-order checks.
      await tx.$queryRaw`
        SELECT id FROM "riders"
        WHERE id = ${req.rider.id} AND franchise_id = ${franchiseId}
        FOR UPDATE
      `;
      const rider = await tx.rider.findFirst({
        where: { id: req.rider.id, franchise_id: franchiseId },
      });
      if (!rider) throw forbidden("Rider profile not found in this franchise");
      if (!rider.is_approved || !rider.is_online) {
        throw forbidden("Rider must be approved and online to accept orders");
      }
      if (rider.cash_in_hand.gte(rider.max_cash_limit)) {
        throw new AppError(
          422,
          "CASH_LIMIT_EXCEEDED",
          "Cash in hand has reached the limit. Settle cash with the franchise first."
        );
      }

      const activeCount = await tx.order.count({
        where: {
          franchise_id: franchiseId,
          rider_id: rider.id,
          order_status: { in: ACTIVE_ORDER_STATUSES },
        },
      });
      if (activeCount >= rider.max_active_orders) {
        throw new AppError(
          422,
          "MAX_ORDERS_EXCEEDED",
          "You already have the maximum number of active orders"
        );
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          rider_id: rider.id,
          order_status: "RIDER_ASSIGNED",
          is_batched_addon: activeCount > 0,
        },
        include: { vendor: { select: { user_id: true, shop_name: true } } },
      });
    }, TX_OPTIONS);

    joinRiderToOrder(req.rider.id, order.id);
    const event = { order_id: order.id, order_number: order.order_number };
    emitTo(rooms.franchiseRiders(franchiseId), "order_taken", event);
    emitTo(rooms.franchise(franchiseId), "order_accepted", event);
    if (order.vendor_id) {
      emitTo(rooms.vendor(order.vendor_id), "order_accepted", event);
      pushToUsers([order.vendor.user_id], {
        title: "✅ Order Accepted",
        body: `Order #${order.order_number} has a rider`,
        data: {
          type: "ORDER_ACCEPTED",
          order_id: order.id,
          franchise_slug: req.franchise.slug,
          deep_link: `dropputt://vendor/orders/${order.id}`,
        },
      });
    }

    ok(res, {
      order: { ...orderView(order), vendor_name: order.vendor?.shop_name ?? null },
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/orders/:id/rider-pickup — bill, customer, payment, financials
// ─────────────────────────────────────────────────────────────────────────────

const pickupSchema = z.object({
  customer_phone: z.union([z.string(), z.number()]).optional(),
  customer_name: z.string().trim().min(1).max(100).optional(),
  zone_id: zId.optional(),
  payment_method: z.enum(["COD", "PREPAID_AT_HOTEL", "UPI_TO_ADMIN"]).optional(),
  item_total: zMoney.optional(),
  rider_paid_at_shop: zBoolean.optional(),
  bill_image_url: z.string().trim().min(1).max(2048).optional(),
});

/** Saved navigation aids for the rider handling this customer's order. */
function navigationView(order, customer) {
  return {
    is_location_verified: Boolean(customer?.is_location_verified),
    drop_lat: order.drop_lat ? order.drop_lat.toFixed(7) : null,
    drop_lng: order.drop_lng ? order.drop_lng.toFixed(7) : null,
    turning_point: order.turning_point ?? customer?.turning_point ?? null,
    voice_direction_url: order.voice_note_url ?? customer?.voice_direction_url ?? null,
    house_image_url: customer?.house_image_url ?? null,
    rider_delivery_note: customer?.rider_delivery_note ?? null,
  };
}

router.put(
  "/:id/rider-pickup",
  requireRole("RIDER"),
  loadRider,
  billImageUpload, // multipart field "bill_image"; JSON bodies also work
  asyncHandler(async (req, res) => {
    const orderId = parseId(req.params.id);
    const franchise_id = req.franchise_id;
    const body = parse(pickupSchema, req.body);

    // Cheap pre-check so a rejected or repeated request never stores a file.
    const current = await prisma.order.findFirst({
      where: { id: orderId, franchise_id },
      select: { rider_id: true, order_status: true },
    });
    if (!current) throw orderNotFound();
    if (current.rider_id !== req.rider.id) throw forbidden("This order is not assigned to you");

    let bill_image_url = body.bill_image_url ?? null;
    if (req.file && current.order_status === "RIDER_ASSIGNED") {
      bill_image_url = await saveUpload(req.file, `bills/${franchise_id}/${orderId}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`
        SELECT id FROM "orders"
        WHERE id = ${orderId} AND franchise_id = ${franchise_id}
        FOR UPDATE
      `;
      if (locked.length === 0) throw orderNotFound();

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, vendor: true },
      });
      if (order.rider_id !== req.rider.id) throw forbidden("This order is not assigned to you");
      if (order.order_status === "DELIVERED") {
        throw new AppError(409, "ORDER_ALREADY_DELIVERED", "Order is already delivered");
      }
      if (order.order_status === "CANCELLED") {
        throw new AppError(409, "ORDER_CANCELLED", "Order has been cancelled");
      }

      // Retried pickup: return the stored state. Nothing is recalculated,
      // so the rain surge can never be added twice.
      if (order.order_status !== "RIDER_ASSIGNED") {
        const customer = order.customer_phone
          ? await tx.customer.findUnique({
              where: {
                franchise_id_phone: { franchise_id, phone: order.customer_phone },
              },
            })
          : null;
        return { order, customer, already_picked_up: true };
      }

      // ── Inputs ────────────────────────────────────────────────────────────
      const customer_phone =
        body.customer_phone !== undefined
          ? normalizePhone(body.customer_phone)
          : order.customer_phone;
      if (!customer_phone) {
        throw fieldError("customer_phone", "a valid 10-digit mobile number is required");
      }

      const zoneId = body.zone_id ?? order.zone_id;
      if (!zoneId) throw fieldError("zone_id", "required");
      const zone = await tx.zone.findFirst({ where: { id: zoneId, franchise_id } });
      if (!zone) throw fieldError("zone_id", "zone not found in this franchise");

      const payment_method = body.payment_method ?? order.payment_method;
      if (payment_method === "PREPAID_AT_HOTEL" && !order.vendor_id) {
        throw fieldError("payment_method", "PREPAID_AT_HOTEL requires a partner vendor");
      }

      // Marketplace orders: item total comes from OrderItem rows only.
      let item_total;
      if (order.items.length > 0) {
        item_total = addMoney(
          ...order.items.map((item) => calculateLineTotal(item.unit_price, item.quantity))
        );
      } else if (body.item_total !== undefined) {
        item_total = money(body.item_total);
      } else if (order.order_type === "PICK_DROP" || order.order_type === "MINI_TRUCK") {
        item_total = money(0);
      } else {
        throw fieldError("item_total", "required");
      }

      const franchise = await tx.franchise.findUnique({ where: { id: franchise_id } });

      // ── Rain surge: at most once per order ────────────────────────────────
      const surge = money(franchise.rain_surge_fee);
      const applySurge = surge.gt(0) && !order.rain_surge_applied;
      // The surge is rider money carried in rider_tip. Folding it in before
      // the split raises rider_tip, rider_earning and grand_total together,
      // and amount_to_collect follows the payment method (so UPI stays 0).
      const rider_tip = applySurge ? addMoney(order.rider_tip, surge) : money(order.rider_tip);

      const financials = calculateOrderFinancials({
        item_total,
        zone,
        franchise,
        payment_method,
        commission_rate: order.vendor?.commission_rate ?? 0,
        rider_tip,
        discount_amount: order.discount_amount,
        shop_markup_profit: order.shop_markup_profit,
        has_partner_vendor: Boolean(order.vendor_id),
      });

      // ── Customer: compound (franchise_id, phone) lookup ───────────────────
      const customer_name = body.customer_name ?? order.customer_name;
      const customer = await tx.customer.upsert({
        where: { franchise_id_phone: { franchise_id, phone: customer_phone } },
        update: body.customer_name ? { name: body.customer_name } : {},
        create: { franchise_id, phone: customer_phone, name: customer_name },
      });
      const verified =
        customer.is_location_verified &&
        customer.verified_lat !== null &&
        customer.verified_lng !== null;

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          order_status: "PICKED_UP",
          customer_phone,
          customer_name,
          zone_id: zone.id,
          payment_method,
          bill_image_url: bill_image_url ?? order.bill_image_url,
          rider_paid_at_shop:
            order.order_type === "CUSTOM_BUY" ? Boolean(body.rider_paid_at_shop) : false,
          rain_surge_applied: order.rain_surge_applied || applySurge,
          ...(verified
            ? { drop_lat: customer.verified_lat, drop_lng: customer.verified_lng }
            : {}),
          turning_point: order.turning_point ?? customer.turning_point,
          voice_note_url: order.voice_note_url ?? customer.voice_direction_url,
          // Rate fixed at pickup so the commission split can be re-derived later.
          commission_rate: order.vendor_id ? moneyStr(order.vendor.commission_rate) : null,
          item_total: moneyStr(financials.item_total),
          delivery_fee: moneyStr(financials.delivery_fee),
          rider_tip: moneyStr(financials.rider_tip),
          grand_total: moneyStr(financials.grand_total),
          vendor_commission: moneyStr(financials.vendor_commission),
          vendor_earning: moneyStr(financials.vendor_earning),
          rider_earning: moneyStr(financials.rider_earning),
          franchise_profit: moneyStr(financials.franchise_profit),
          super_admin_profit: moneyStr(financials.super_admin_profit),
          amount_to_collect: moneyStr(financials.amount_to_collect),
          vendor_admin_payable: moneyStr(financials.vendor_admin_payable),
        },
        include: { vendor: true },
      });

      if (applySurge) {
        await tx.settlementEntry.create({
          data: {
            franchise_id,
            order_id: orderId,
            rider_id: req.rider.id,
            party: "RIDER_EARNING",
            type: "RAIN_SURGE",
            amount: moneyStr(surge),
            reference_key: `order:${orderId}:rain-surge`,
            description: `Rain surge for order ${order.order_number}`,
          },
        });
      }

      audit("order.pickup", {
        franchise_id,
        order_id: orderId,
        rider_id: req.rider.id,
        payment_method,
        grand_total: moneyStr(financials.grand_total),
        amount_to_collect: moneyStr(financials.amount_to_collect),
        rain_surge: applySurge ? moneyStr(surge) : null,
      });

      return { order: updated, customer, already_picked_up: false };
    }, TX_OPTIONS);

    const { order, customer, already_picked_up } = result;
    if (!already_picked_up) {
      const event = { order_id: order.id, order_status: order.order_status };
      emitTo(rooms.order(order.id), "order_status_changed", event);
      if (order.vendor_id) {
        emitTo(rooms.vendor(order.vendor_id), "order_picked_up", event);
        pushToUsers([order.vendor.user_id], {
          title: "🛵 Rider On The Way",
          body: `Order #${order.order_number} has been picked up`,
          data: {
            type: "ORDER_PICKED_UP",
            order_id: order.id,
            franchise_slug: req.franchise.slug,
            deep_link: `dropputt://vendor/orders/${order.id}`,
          },
        });
      }
    }

    ok(res, {
      order: orderView(order),
      navigation: navigationView(order, customer),
      magic_link_path: `/drop/${order.location_token}`,
      already_picked_up,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/orders/:id/deliver — gate verification + atomic settlement
// ─────────────────────────────────────────────────────────────────────────────

const deliverSchema = z.object({
  rider_lat: zLat,
  rider_lng: zLng,
  rider_delivery_note: z.string().trim().min(1).max(500).optional(),
  gate_photo_url: z.string().trim().min(1).max(2048).optional(),
});

router.post(
  "/:id/deliver",
  requireRole("RIDER"),
  loadRider,
  idempotency(),
  asyncHandler(async (req, res) => {
    const orderId = parseId(req.params.id);
    const franchise_id = req.franchise_id;
    const riderId = req.rider.id;
    const body = parse(deliverSchema, req.body);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Lock order.
      const locked = await tx.$queryRaw`
        SELECT id FROM "orders"
        WHERE id = ${orderId} AND franchise_id = ${franchise_id}
        FOR UPDATE
      `;
      if (locked.length === 0) throw orderNotFound();
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (order.rider_id !== riderId) throw forbidden("This order is not assigned to you");

      // A retry after commit returns the settled state; no money moves.
      if (order.settlement_completed || order.order_status === "DELIVERED") {
        return { order, already_delivered: true };
      }
      if (order.order_status !== "PICKED_UP" && order.order_status !== "LOCATION_SHARED") {
        throw new AppError(
          409,
          "ORDER_NOT_DELIVERABLE",
          `Order cannot be delivered from status ${order.order_status}`
        );
      }

      // 2–4. Lock rider, vendor (if any), franchise — always in this order.
      await tx.$queryRaw`SELECT id FROM "riders" WHERE id = ${riderId} FOR UPDATE`;
      if (order.vendor_id) {
        await tx.$queryRaw`SELECT id FROM "vendors" WHERE id = ${order.vendor_id} FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT id FROM "franchises" WHERE id = ${franchise_id} FOR UPDATE`;
      const franchise = await tx.franchise.findUnique({ where: { id: franchise_id } });

      const delivered_at = new Date();
      const entry = (data) =>
        tx.settlementEntry.create({ data: { franchise_id, order_id: orderId, ...data } });

      // 6–7. Mark delivered first so today's milestone count includes it.
      const delivered = await tx.order.update({
        where: { id: orderId },
        data: {
          order_status: "DELIVERED",
          delivered_at,
          royalty_deducted: true,
          settlement_completed: true,
        },
      });

      // 8. Gate verification: the rider's GPS at the door becomes the
      //    customer's verified location for future orders.
      if (order.customer_phone) {
        const gate = {
          verified_lat: body.rider_lat.toFixed(7),
          verified_lng: body.rider_lng.toFixed(7),
          is_location_verified: true,
          ...(body.rider_delivery_note
            ? { rider_delivery_note: body.rider_delivery_note }
            : {}),
          ...(body.gate_photo_url ? { house_image_url: body.gate_photo_url } : {}),
        };
        await tx.customer.upsert({
          where: {
            franchise_id_phone: { franchise_id, phone: order.customer_phone },
          },
          update: gate,
          create: {
            franchise_id,
            phone: order.customer_phone,
            name: order.customer_name,
            ...gate,
          },
        });
      }

      // 9. Cash collection (COD: grand total; prepaid-at-hotel: delivery
      //    side only; UPI: nothing; rider-paid custom-buy: excludes the
      //    rider's own advance).
      const cash = calculateCashInHandIncrease(order);
      if (cash.gt(0)) {
        await entry({
          rider_id: riderId,
          party: "RIDER_CASH",
          type: "ORDER_PAYMENT",
          amount: moneyStr(cash),
          reference_key: `order:${orderId}:cash-collection`,
          description: `Cash collected (${order.payment_method}) for order ${order.order_number}`,
        });
      }

      // 10. Vendor ledger (signed: negative = vendor owes the platform).
      const vendorPayable = money(order.vendor_admin_payable);
      if (order.vendor_id) {
        await tx.vendor.update({
          where: { id: order.vendor_id },
          data: { admin_payable_balance: { increment: moneyStr(vendorPayable) } },
        });
        await entry({
          vendor_id: order.vendor_id,
          party: "VENDOR_PAYABLE",
          type: "VENDOR_PAYABLE",
          amount: moneyStr(vendorPayable),
          reference_key: `order:${orderId}:vendor-payable`,
          description: `Vendor payable (${order.payment_method}) for order ${order.order_number}`,
        });
      }

      // 11. Rider earnings.
      let riderCredit = money(order.rider_earning);
      await entry({
        rider_id: riderId,
        party: "RIDER_EARNING",
        type: "ORDER_DELIVERY",
        amount: moneyStr(order.rider_earning),
        reference_key: `order:${orderId}:rider-earning`,
        description: `Rider earning for order ${order.order_number}`,
      });

      // 12. Daily milestone — once per rider / IST date / target.
      let milestone = null;
      const day = istDayRange(delivered_at);
      const deliveredToday = await tx.order.count({
        where: {
          franchise_id,
          rider_id: riderId,
          order_status: "DELIVERED",
          delivered_at: { gte: day.start, lt: day.end },
        },
      });
      const bonus = money(franchise.daily_milestone_bonus);
      if (deliveredToday === franchise.daily_milestone_target && bonus.gt(0)) {
        const reference_key = `rider:${riderId}:milestone:${day.date}:${franchise.daily_milestone_target}`;
        const granted = await tx.settlementEntry.findUnique({ where: { reference_key } });
        if (!granted) {
          await entry({
            rider_id: riderId,
            party: "RIDER_EARNING",
            type: "MILESTONE_BONUS",
            amount: moneyStr(bonus),
            reference_key,
            description: `Daily milestone bonus (${franchise.daily_milestone_target} deliveries on ${day.date})`,
          });
          riderCredit = addMoney(riderCredit, bonus);
          milestone = {
            bonus: bonus.toNumber(),
            target: franchise.daily_milestone_target,
          };
        }
      }

      await tx.rider.update({
        where: { id: riderId },
        data: {
          cash_in_hand: { increment: moneyStr(cash) },
          wallet_earnings: { increment: moneyStr(riderCredit) },
        },
      });

      // Franchise profit, recorded for reconciliation (§41).
      await entry({
        party: "FRANCHISE_PROFIT",
        type: "ORDER_DELIVERY",
        amount: moneyStr(order.franchise_profit),
        reference_key: `order:${orderId}:franchise-profit`,
        description: `Franchise profit for order ${order.order_number}`,
      });

      // 13. Royalty — exactly once. The amount is the one fixed on the
      //     order at pickup, so the split and the wallet debit always agree.
      const royalty = money(order.super_admin_profit);
      if (!order.royalty_deducted) {
        const balance_after = subtractMoney(franchise.wallet_balance, royalty);
        await tx.franchise.update({
          where: { id: franchise_id },
          data: { wallet_balance: moneyStr(balance_after) },
        });
        await tx.walletTransaction.create({
          data: {
            franchise_id,
            order_id: orderId,
            type: "DEBIT",
            amount: moneyStr(royalty),
            balance_after: moneyStr(balance_after),
            description: `Royalty for order ${order.order_number}`,
          },
        });
        await entry({
          party: "SUPER_ADMIN_ROYALTY",
          type: "ROYALTY",
          amount: moneyStr(royalty),
          reference_key: `order:${orderId}:royalty`,
          description: `Royalty for order ${order.order_number}`,
        });
      }

      audit("order.delivered", {
        franchise_id,
        order_id: orderId,
        rider_id: riderId,
        vendor_id: order.vendor_id,
        payment_method: order.payment_method,
        cash_collected: moneyStr(cash),
        vendor_payable: order.vendor_id ? moneyStr(vendorPayable) : null,
        rider_earning: moneyStr(order.rider_earning),
        milestone_bonus: milestone ? moneyStr(bonus) : null,
        royalty: moneyStr(royalty),
      });

      return {
        order: delivered,
        already_delivered: false,
        cash_collected: moneyStr(cash),
        milestone,
      };
    }, TX_OPTIONS);

    const { order } = result;
    if (!result.already_delivered) {
      const event = { order_id: order.id, order_status: "DELIVERED" };
      emitTo(rooms.order(order.id), "order_status_changed", event);
      emitTo(rooms.franchise(franchise_id), "order_delivered", event);
      if (order.vendor_id) emitTo(rooms.vendor(order.vendor_id), "order_delivered", event);

      if (result.milestone) {
        emitTo(rooms.rider(riderId), "milestone_achieved", result.milestone);
        pushToUsers([req.user.id], {
          title: "🏆 Milestone Bonus!",
          body: `You earned ₹${result.milestone.bonus} for ${result.milestone.target} deliveries today`,
          data: {
            type: "MILESTONE_BONUS",
            franchise_slug: req.franchise.slug,
            deep_link: "dropputt://rider/earnings",
          },
          channel: "earnings",
        });
      }
    }

    ok(res, {
      order: orderView(order),
      already_delivered: result.already_delivered,
      settlement: result.already_delivered
        ? null
        : { cash_collected: result.cash_collected, milestone: result.milestone },
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/orders/:id/cancel — the shop (before pickup) or the franchise
// admin (any time before delivery) cancels an order. Idempotent.
// ─────────────────────────────────────────────────────────────────────────────

const cancelSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

router.post(
  "/:id/cancel",
  requireRole("VENDOR", "FRANCHISE_ADMIN"),
  asyncHandler(async (req, res) => {
    const orderId = parseId(req.params.id);
    const body = parse(cancelSchema, req.body ?? {});
    const franchise_id = req.franchise_id;

    let vendor_id;
    if (req.user.role === "VENDOR") {
      const vendor = await prisma.vendor.findFirst({
        where: { user_id: req.user.id, franchise_id },
        select: { id: true },
      });
      if (!vendor) throw forbidden("Vendor profile not found in this franchise");
      vendor_id = vendor.id;
    }

    const { order, already } = await cancelOrder({
      orderId,
      franchise_id,
      role: req.user.role,
      vendor_id,
      reason: body.reason,
      franchise_slug: req.franchise.slug,
    });
    ok(res, { order: orderView(order), already });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Read endpoints for the Vendor and Rider apps
// ─────────────────────────────────────────────────────────────────────────────

const ALL_ORDER_STATUSES = [
  "RIDER_REQUESTED",
  "RIDER_ASSIGNED",
  "PICKED_UP",
  "LOCATION_SHARED",
  "DELIVERED",
  "CANCELLED",
];
const BOARD_STATUSES = ["RIDER_REQUESTED", ...ACTIVE_ORDER_STATUSES];

const BOARD_INCLUDE = {
  vendor: { select: { shop_name: true, address: true } },
  items: {
    select: {
      product_id: true,
      quantity: true,
      line_total: true,
      product: { select: { name: true } },
    },
  },
  rider: { select: { vehicle_number: true, user: { select: { name: true } } } },
};

function boardOrderView(order, role) {
  const view = {
    ...orderView(order),
    shop_name: order.vendor?.shop_name ?? order.custom_shop_name ?? null,
    items: order.items.map((item) => ({
      product_id: item.product_id,
      name: item.product.name,
      quantity: item.quantity,
      line_total: moneyStr(item.line_total),
    })),
  };
  if (role === "VENDOR" || role === "FRANCHISE_ADMIN") {
    // Vendors see who is coming, never what the rider earns.
    delete view.rider_earning;
    delete view.rider_tip;
    view.rider = order.rider
      ? { name: order.rider.user.name, vehicle_number: order.rider.vehicle_number }
      : null;
  }
  return view;
}

// GET /api/v1/orders — paginated history (SPEC §48), newest first.
//   RIDER → own orders, VENDOR → own shop, FRANCHISE_ADMIN → whole franchise.
//   Optional ?status=DELIVERED (any OrderStatus).
router.get(
  "/",
  requireRole("VENDOR", "FRANCHISE_ADMIN", "RIDER"),
  asyncHandler(async (req, res) => {
    const franchise_id = req.franchise_id;
    const role = req.user.role;
    const { limit, cursorId } = parsePagination(req.query);

    const where = { franchise_id };
    if (req.query.status) {
      const status = String(req.query.status).toUpperCase();
      if (!ALL_ORDER_STATUSES.includes(status)) {
        throw validationError("Request validation failed", [
          { field: "status", issue: "unknown order status" },
        ]);
      }
      where.order_status = status;
    }
    if (role === "RIDER") {
      const rider = await prisma.rider.findFirst({
        where: { user_id: req.user.id, franchise_id },
        select: { id: true },
      });
      if (!rider) throw forbidden("Rider profile not found in this franchise");
      where.rider_id = rider.id;
    } else if (role === "VENDOR") {
      const vendor = await prisma.vendor.findFirst({
        where: { user_id: req.user.id, franchise_id },
        select: { id: true },
      });
      if (!vendor) throw forbidden("Vendor profile not found in this franchise");
      where.vendor_id = vendor.id;
    }
    if (cursorId) where.id = { lt: cursorId };

    const rows = await prisma.order.findMany({
      where,
      orderBy: { id: "desc" },
      take: limit + 1,
      include: BOARD_INCLUDE,
    });
    const page = buildPage(rows, limit);
    ok(res, { orders: page.items.map((order) => boardOrderView(order, role)) }, {
      pagination: page.pagination,
    });
  })
);

// GET /api/v1/orders/zones — delivery zones of this franchise.
router.get(
  "/zones",
  asyncHandler(async (req, res) => {
    const zones = await prisma.zone.findMany({
      where: { franchise_id: req.franchise_id },
      orderBy: { delivery_fee: "asc" },
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

// GET /api/v1/orders/active
//   VENDOR          → this shop's open orders
//   FRANCHISE_ADMIN → every open order of the franchise
//   RIDER           → own active orders + unassigned requests to catch up on
router.get(
  "/active",
  requireRole("VENDOR", "FRANCHISE_ADMIN", "RIDER"),
  asyncHandler(async (req, res) => {
    const franchise_id = req.franchise_id;
    const role = req.user.role;

    if (role === "RIDER") {
      const rider = await prisma.rider.findFirst({
        where: { user_id: req.user.id, franchise_id },
      });
      if (!rider) throw forbidden("Rider profile not found in this franchise");

      const orders = await prisma.order.findMany({
        where: { franchise_id, rider_id: rider.id, order_status: { in: ACTIVE_ORDER_STATUSES } },
        orderBy: { created_at: "asc" },
        include: BOARD_INCLUDE,
      });

      // Saved navigation aids for the customers on these orders.
      const phones = [...new Set(orders.map((o) => o.customer_phone).filter(Boolean))];
      const customers = phones.length
        ? await prisma.customer.findMany({ where: { franchise_id, phone: { in: phones } } })
        : [];
      const byPhone = new Map(customers.map((c) => [c.phone, c]));

      const open_requests =
        rider.is_online && rider.is_approved && rider.cash_in_hand.lt(rider.max_cash_limit)
          ? await prisma.order.findMany({
              where: {
                franchise_id,
                order_status: "RIDER_REQUESTED",
                order_type:
                  rider.vehicle_type === "MINI_TRUCK" ? "MINI_TRUCK" : { not: "MINI_TRUCK" },
              },
              orderBy: { created_at: "asc" },
              take: 20,
              include: BOARD_INCLUDE,
            })
          : [];

      return ok(res, {
        orders: orders.map((order) => ({
          ...boardOrderView(order, role),
          navigation: order.customer_phone
            ? navigationView(order, byPhone.get(order.customer_phone))
            : null,
        })),
        open_requests: open_requests.map((order) => ({
          order_id: order.id,
          order_number: order.order_number,
          order_type: order.order_type,
          shop_name: order.vendor?.shop_name ?? order.custom_shop_name ?? null,
          pickup_address: order.pickup_address,
          drop_address: order.drop_address,
          zone_id: order.zone_id,
        })),
      });
    }

    let vendor_id;
    if (role === "VENDOR") {
      const vendor = await prisma.vendor.findFirst({
        where: { user_id: req.user.id, franchise_id },
        select: { id: true },
      });
      if (!vendor) throw forbidden("Vendor profile not found in this franchise");
      vendor_id = vendor.id;
    }
    const orders = await prisma.order.findMany({
      where: {
        franchise_id,
        order_status: { in: BOARD_STATUSES },
        ...(vendor_id ? { vendor_id } : {}),
      },
      orderBy: { created_at: "desc" },
      take: 100,
      include: BOARD_INCLUDE,
    });
    ok(res, { orders: orders.map((order) => boardOrderView(order, role)) });
  })
);

// GET /api/v1/orders/customer-lookup?phone=... — pickup auto-lookup badge.
router.get(
  "/customer-lookup",
  requireRole("RIDER"),
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.query.phone);
    if (!phone) throw fieldError("phone", "must be a valid 10-digit mobile number");
    const customer = await prisma.customer.findUnique({
      where: { franchise_id_phone: { franchise_id: req.franchise_id, phone } },
    });
    ok(res, {
      phone,
      found: Boolean(customer),
      name: customer?.name ?? null,
      is_location_verified: Boolean(customer?.is_location_verified),
      voice_direction_url: customer?.voice_direction_url ?? null,
      turning_point: customer?.turning_point ?? null,
      house_image_url: customer?.house_image_url ?? null,
      rider_delivery_note: customer?.rider_delivery_note ?? null,
    });
  })
);

// POST /api/v1/orders/:id/gate-photo — optional gate photo before delivery.
router.post(
  "/:id/gate-photo",
  requireRole("RIDER"),
  loadRider,
  gatePhotoUpload,
  asyncHandler(async (req, res) => {
    const orderId = parseId(req.params.id);
    if (!req.file) throw fieldError("gate_photo", "an image file is required");
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        franchise_id: req.franchise_id,
        rider_id: req.rider.id,
        order_status: { in: ACTIVE_ORDER_STATUSES },
      },
      select: { id: true },
    });
    if (!order) throw orderNotFound();
    const gate_photo_url = await saveUpload(
      req.file,
      `gates/${req.franchise_id}/${orderId}`
    );
    ok(res, { gate_photo_url });
  })
);

export default router;
