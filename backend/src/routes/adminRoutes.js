// /api/v1/admin — rider cash settlement and franchise wallet top-up.
//
// The tenant always comes from x-franchise-slug. A FRANCHISE_ADMIN can only
// act on their own franchise (enforced in `authenticate`); the global
// SUPER_ADMIN acts on whichever franchise the header selects.

import { Router } from "express";
import { z } from "zod";
import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  buildReconciliation,
  checkOrders,
  orderRow,
  parseRange,
  reconciliationOrders,
} from "../services/reconciliationService.js";
import { emitTo, rooms } from "../socket/socketHandler.js";
import { ACTIVE_ORDER_STATUSES } from "../utils/constants.js";
import { minutesAgo, staleRules } from "../utils/staleRules.js";
import { coordStr } from "../utils/serializers.js";
import { istDayRange } from "../utils/time.js";
import { idempotency } from "../middleware/idempotency.js";
import { audit } from "../utils/audit.js";
import { netSettleRider, payoutView, payRider } from "../services/riderPayoutService.js";
import {
  recordVendorSettlement,
  settlementView,
} from "../services/vendorSettlementService.js";
import {
  createHandover,
  handoverInclude,
  handoverView,
  isCashLocked,
  netDue,
  resolveHandover,
} from "../services/cashHandoverService.js";
import { addMoney, money } from "../utils/orderMath.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { AppError, asyncHandler, forbidden, ok, validationError } from "../utils/response.js";
import { isCommissionFreeOrder, moneyStr } from "../utils/serializers.js";
import { parse, parseId, zMoney } from "../utils/validate.js";

/**
 * Throws a validation error if x-franchise-slug header is missing.
 * Prevents financial mutations from silently targeting the default franchise
 * when a Super Admin forgets the header during development or testing.
 */
function requireFranchiseHeader(req) {
  if (!req.get("x-franchise-slug")) {
    throw validationError("Request validation failed", [
      {
        field: "x-franchise-slug",
        issue: "header is required for financial operations",
      },
    ]);
  }
}

const router = Router();
router.use(authenticate);

const amountSchema = zMoney.refine((value) => Number(value) > 0, {
  message: "must be greater than 0",
});

// GET /api/v1/admin/riders — cash and earnings overview.
router.get(
  "/riders",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { limit, cursorId } = parsePagination(req.query);
    const riders = await prisma.rider.findMany({
      where: {
        franchise_id: req.franchise_id,
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      include: { user: { select: { name: true, phone: true, is_active: true } } },
    });
    const page = buildPage(riders, limit);
    ok(
      res,
      {
        items: page.items.map((rider) => ({
          id: rider.id,
          name: rider.user.name,
          phone: rider.user.phone,
          is_active: rider.user.is_active,
          is_online: rider.is_online,
          is_approved: rider.is_approved,
          vehicle_type: rider.vehicle_type,
          cash_in_hand: moneyStr(rider.cash_in_hand),
          max_cash_limit: moneyStr(rider.max_cash_limit),
          wallet_earnings: moneyStr(rider.wallet_earnings),
          net_due: moneyStr(netDue(rider)),
        })),
      },
      { pagination: page.pagination }
    );
  })
);

// POST /api/v1/admin/riders/:id/cash-settlement
//
// The rider hands collected cash to the franchise; cash_in_hand goes down
// by `amount`. Send an Idempotency-Key header so a retry cannot settle twice.
const cashSettlementSchema = z.object({
  amount: amountSchema,
  note: z.string().trim().min(1).max(300).optional(),
});

router.post(
  "/riders/:id/cash-settlement",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  idempotency(),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const riderId = parseId(req.params.id);
    const body = parse(cashSettlementSchema, req.body);
    // Direct admin settlement (cash the franchise holds itself). It now
    // leaves a RiderCashHandover row and notifies the rider.
    const row = await createHandover(
      {
        franchise: req.franchise,
        rider_id: riderId,
        amount: body.amount,
        note: body.note,
        initiated_by: "ADMIN",
        user_id: req.user.id,
      },
      { requestId: res.locals.request_id }
    );

    ok(res, {
      rider_id: riderId,
      amount_settled: moneyStr(row.amount),
      cash_in_hand_before: moneyStr(row.cash_before),
      cash_in_hand: moneyStr(row.cash_after),
      handover_id: row.id,
    });
  })
);

// GET /api/v1/admin/cash-handovers?status=PENDING — rider → vendor handovers.
// Pending ones the vendor has not answered can be resolved by the admin so a
// busy accountant never keeps a rider blocked.
router.get(
  "/cash-handovers",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const status = ["PENDING", "CONFIRMED", "REJECTED"].includes(req.query.status)
      ? req.query.status
      : undefined;
    const rows = await prisma.riderCashHandover.findMany({
      where: { franchise_id: req.franchise_id, ...(status ? { status } : {}) },
      orderBy: { id: "desc" },
      take: 50,
      include: handoverInclude,
    });
    ok(res, { items: rows.map(handoverView) });
  })
);

for (const action of ["confirm", "reject"]) {
  router.post(
    `/cash-handovers/:id/${action}`,
    requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
    asyncHandler(async (req, res) => {
      requireFranchiseHeader(req);
      const row = await resolveHandover(
        {
          franchise: req.franchise,
          handover_id: parseId(req.params.id),
          action,
          user_id: req.user.id,
        },
        { requestId: res.locals.request_id }
      );
      ok(res, { handover: handoverView(row) });
    })
  );
}

// ── Vendor commission settlement (§16.1) ────────────────────────────────────
// The hotel never pays per order. Storefront commission accrues in the
// vendor's signed balance; the admin visits the hotel daily / weekly / monthly
// and records the payment here.

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/v1/admin/vendors — balance and recent commission per hotel.
router.get(
  "/vendors",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const franchise_id = req.franchise_id;
    const today = istDayRange();
    const windows = {
      today: today.start,
      last_7_days: new Date(today.end.getTime() - 7 * DAY_MS),
      last_30_days: new Date(today.end.getTime() - 30 * DAY_MS),
    };
    const [vendors, sums, lastSettlements] = await Promise.all([
      prisma.vendor.findMany({
        where: { franchise_id },
        orderBy: { shop_name: "asc" },
        select: {
          id: true,
          shop_name: true,
          shop_category: true,
          admin_payable_balance: true,
          commission_rate: true,
          commission_free_until: true,
          app_enabled: true,
        },
      }),
      Promise.all(
        Object.entries(windows).map(async ([name, since]) => {
          const rows = await prisma.order.groupBy({
            by: ["vendor_id"],
            where: {
              franchise_id,
              vendor_id: { not: null },
              order_status: "DELIVERED",
              delivered_at: { gte: since },
            },
            _sum: { vendor_commission: true },
          });
          return [name, new Map(rows.map((r) => [r.vendor_id, r._sum.vendor_commission]))];
        })
      ),
      prisma.vendorSettlement.groupBy({
        by: ["vendor_id"],
        where: { franchise_id },
        _max: { created_at: true },
      }),
    ]);
    const last = new Map(lastSettlements.map((r) => [r.vendor_id, r._max.created_at]));
    ok(res, {
      vendors: vendors.map((vendor) => {
        const balance = money(vendor.admin_payable_balance);
        return {
          id: vendor.id,
          shop_name: vendor.shop_name,
          shop_category: vendor.shop_category,
          admin_payable_balance: moneyStr(balance),
          commission_rate: moneyStr(vendor.commission_rate),
          commission_free_until: vendor.commission_free_until,
          app_enabled: vendor.app_enabled,
          trial_active: Boolean(vendor.commission_free_until) && vendor.commission_free_until > new Date(),
          // Who owes whom, spelled out so the screen needs no sign logic.
          owes: balance.lt(0) ? "VENDOR" : balance.gt(0) ? "FRANCHISE" : "NONE",
          commission: Object.fromEntries(
            sums.map(([name, bySum]) => [name, moneyStr(bySum.get(vendor.id) ?? 0)])
          ),
          last_settlement_at: last.get(vendor.id) ?? null,
        };
      }),
    });
  })
);

// GET /api/v1/admin/vendors/:id/statement?from=YYYY-MM-DD&to=YYYY-MM-DD
// Delivered orders in the range with commission, plus the settlements made.
router.get(
  "/vendors/:id/statement",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const vendorId = parseId(req.params.id);
    const franchise_id = req.franchise_id;
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, franchise_id },
      select: { id: true, shop_name: true, admin_payable_balance: true, commission_rate: true },
    });
    if (!vendor) throw new AppError(404, "VENDOR_NOT_FOUND", "Vendor not found in this franchise");
    const range = parseRange(req.query);

    const [orders, settlements] = await Promise.all([
      prisma.order.findMany({
        where: {
          franchise_id,
          vendor_id: vendorId,
          order_status: "DELIVERED",
          delivered_at: { gte: range.start, lt: range.end },
        },
        orderBy: { delivered_at: "asc" },
        take: 1000,
        select: {
          id: true,
          order_number: true,
          order_type: true,
          payment_method: true,
          item_total: true,
          vendor_id: true,
          commission_rate: true,
          vendor_commission: true,
          vendor_admin_payable: true,
          delivered_at: true,
        },
      }),
      prisma.vendorSettlement.findMany({
        where: { franchise_id, vendor_id: vendorId, created_at: { gte: range.start, lt: range.end } },
        orderBy: { id: "asc" },
      }),
    ]);

    const totals = orders.reduce(
      (t, o) => ({
        orders: t.orders + 1,
        item_total: addMoney(t.item_total, o.item_total),
        commission: addMoney(t.commission, o.vendor_commission),
        payable: addMoney(t.payable, o.vendor_admin_payable),
      }),
      { orders: 0, item_total: money(0), commission: money(0), payable: money(0) }
    );
    ok(res, {
      vendor: {
        id: vendor.id,
        shop_name: vendor.shop_name,
        commission_rate: moneyStr(vendor.commission_rate),
        admin_payable_balance: moneyStr(vendor.admin_payable_balance),
      },
      range: { from: range.from, to: range.to },
      totals: {
        orders: totals.orders,
        item_total: moneyStr(totals.item_total),
        commission: moneyStr(totals.commission),
        payable: moneyStr(totals.payable),
      },
      orders: orders.map((o) => ({
        id: o.id,
        order_number: o.order_number,
        order_type: o.order_type,
        commission_free: isCommissionFreeOrder(o),
        payment_method: o.payment_method,
        item_total: moneyStr(o.item_total),
        commission: moneyStr(o.vendor_commission),
        payable: moneyStr(o.vendor_admin_payable),
        delivered_at: o.delivered_at,
      })),
      settlements: settlements.map(settlementView),
    });
  })
);

const vendorSettlementSchema = z.object({
  direction: z.enum(["VENDOR_PAID_FRANCHISE", "FRANCHISE_PAID_VENDOR"]),
  amount: amountSchema,
  method: z.enum(["CASH", "UPI", "BANK"]).default("CASH"),
  note: z.string().trim().min(1).max(300).optional(),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// POST /api/v1/admin/vendors/:id/settlements — record a payment with a hotel.
router.post(
  "/vendors/:id/settlements",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  idempotency(),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const vendorId = parseId(req.params.id);
    const body = parse(vendorSettlementSchema, req.body);
    const row = await recordVendorSettlement(
      {
        franchise: req.franchise,
        vendor_id: vendorId,
        direction: body.direction,
        amount: body.amount,
        method: body.method,
        note: body.note,
        period_from: body.period_from ? new Date(`${body.period_from}T00:00:00+05:30`) : null,
        period_to: body.period_to ? new Date(`${body.period_to}T00:00:00+05:30`) : null,
        user_id: req.user.id,
      },
      { requestId: res.locals.request_id }
    );
    ok(res, { settlement: settlementView(row) }, { status: 201 });
  })
);

// PATCH /api/v1/admin/riders/:id/cash-limit — raise or lower one rider's cash
// limit. Franchise admin and Super Admin; the rider is blocked while
// cash_in_hand >= max_cash_limit, so this also unblocks / blocks at once.
const cashLimitSchema = z.object({
  max_cash_limit: amountSchema.refine((value) => Number(value) <= 100000, {
    message: "must be at most 100000",
  }),
});

router.patch(
  "/riders/:id/cash-limit",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const riderId = parseId(req.params.id);
    const body = parse(cashLimitSchema, req.body);
    const rider = await prisma.rider.findFirst({
      where: { id: riderId, franchise_id: req.franchise_id },
    });
    if (!rider) throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found in this franchise");
    const limit = money(body.max_cash_limit);
    const updated = await prisma.rider.update({
      where: { id: riderId },
      data: { max_cash_limit: moneyStr(limit) },
    });
    const is_cash_locked = money(updated.cash_in_hand).gte(limit);
    audit("rider.cash_limit_changed", {
      franchise_id: req.franchise_id,
      rider_id: riderId,
      by_user_id: req.user.id,
      before: moneyStr(rider.max_cash_limit),
      after: moneyStr(limit),
      request_id: res.locals.request_id,
    });
    emitTo(rooms.rider(riderId), "cash_limit_changed", {
      max_cash_limit: moneyStr(limit),
      cash_in_hand: moneyStr(updated.cash_in_hand),
      is_cash_locked,
    });
    emitTo(rooms.franchise(req.franchise_id), "cash_limit_changed", { rider_id: riderId });
    ok(res, {
      rider_id: riderId,
      max_cash_limit: moneyStr(limit),
      cash_in_hand: moneyStr(updated.cash_in_hand),
      is_cash_locked,
    });
  })
);

// PATCH /api/v1/admin/vendors/:id — a hotel's Call Rider Now free trial and
// commission rate. The trial date is the franchise admin's call; the
// commission percentage is decided by the Super Admin only.
const vendorTermsSchema = z
  .object({
    commission_rate: z.coerce.number().min(0).max(100).optional(),
    commission_free_until: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
      .optional(),
    // false = this shop does not use the app; its riders get the item list (§62).
    app_enabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });

router.patch(
  "/vendors/:id",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const vendorId = parseId(req.params.id);
    const body = parse(vendorTermsSchema, req.body);
    if (body.commission_rate !== undefined && req.user.role !== "SUPER_ADMIN") {
      throw forbidden("Only the Super Admin can change the commission percentage");
    }
    const before = await prisma.vendor.findFirst({
      where: { id: vendorId, franchise_id: req.franchise_id },
    });
    if (!before) throw new AppError(404, "VENDOR_NOT_FOUND", "Vendor not found in this franchise");

    const data = {};
    if (body.app_enabled !== undefined) data.app_enabled = body.app_enabled;
    if (body.commission_rate !== undefined) data.commission_rate = money(body.commission_rate).toFixed(2);
    if (body.commission_free_until !== undefined) {
      // The trial runs through the end of the chosen IST day.
      data.commission_free_until =
        body.commission_free_until === null
          ? null
          : new Date(new Date(`${body.commission_free_until}T00:00:00+05:30`).getTime() + DAY_MS);
      if (data.commission_free_until && Number.isNaN(data.commission_free_until.getTime())) {
        throw validationError("Request validation failed", [
          { field: "commission_free_until", issue: "must be a date like 2026-11-30" },
        ]);
      }
    }
    const vendor = await prisma.vendor.update({ where: { id: vendorId }, data });
    audit("vendor.terms_changed", {
      franchise_id: req.franchise_id,
      vendor_id: vendorId,
      by_user_id: req.user.id,
      before: {
        commission_rate: moneyStr(before.commission_rate),
        commission_free_until: before.commission_free_until,
        app_enabled: before.app_enabled,
      },
      after: {
        commission_rate: moneyStr(vendor.commission_rate),
        commission_free_until: vendor.commission_free_until,
        app_enabled: vendor.app_enabled,
      },
      request_id: res.locals.request_id,
    });
    ok(res, {
      vendor: {
        id: vendor.id,
        commission_rate: moneyStr(vendor.commission_rate),
        commission_free_until: vendor.commission_free_until,
        app_enabled: vendor.app_enabled,
        trial_active: Boolean(vendor.commission_free_until) && vendor.commission_free_until > new Date(),
      },
    });
  })
);

// ── Rider earnings payout (§15.2) ───────────────────────────────────────────

const payoutSchema = z.object({
  amount: amountSchema,
  method: z.enum(["CASH", "UPI", "BANK"]).default("CASH"),
  note: z.string().trim().min(1).max(300).optional(),
});

// POST /api/v1/admin/riders/:id/payouts — pay part or all of a rider's wallet.
router.post(
  "/riders/:id/payouts",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  idempotency(),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const body = parse(payoutSchema, req.body);
    const row = await payRider(
      {
        franchise: req.franchise,
        rider_id: parseId(req.params.id),
        amount: body.amount,
        method: body.method,
        note: body.note,
        user_id: req.user.id,
      },
      { requestId: res.locals.request_id }
    );
    ok(res, { payout: payoutView(row) }, { status: 201 });
  })
);

const netSchema = z.object({ note: z.string().trim().min(1).max(300).optional() });

// POST /api/v1/admin/riders/:id/net-settlement — collect all cash, pay all
// earnings; only the difference changes hands.
router.post(
  "/riders/:id/net-settlement",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  idempotency(),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const body = parse(netSchema, req.body ?? {});
    const result = await netSettleRider(
      { franchise: req.franchise, rider_id: parseId(req.params.id), note: body.note, user_id: req.user.id },
      { requestId: res.locals.request_id }
    );
    ok(res, result);
  })
);

// POST /api/v1/admin/franchise/wallet/top-up
//
// Credits the royalty wallet of the franchise named by x-franchise-slug.
// Only the Super Admin receives the money, so only the Super Admin records it.
const topUpSchema = z.object({
  amount: amountSchema,
  description: z.string().trim().min(1).max(300).optional(),
});

router.post(
  "/franchise/wallet/top-up",
  requireRole("SUPER_ADMIN"),
  idempotency(),
  asyncHandler(async (req, res) => {
    requireFranchiseHeader(req);
    const franchise_id = req.franchise_id;
    const body = parse(topUpSchema, req.body);
    const amount = money(body.amount);

    const transaction = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "franchises" WHERE id = ${franchise_id} FOR UPDATE`;
      const franchise = await tx.franchise.findUnique({ where: { id: franchise_id } });
      const balance_after = addMoney(franchise.wallet_balance, amount);
      await tx.franchise.update({
        where: { id: franchise_id },
        data: { wallet_balance: moneyStr(balance_after) },
      });
      return tx.walletTransaction.create({
        data: {
          franchise_id,
          type: "CREDIT",
          amount: moneyStr(amount),
          balance_after: moneyStr(balance_after),
          description: body.description ?? "Wallet top-up",
        },
      });
    }, TX_OPTIONS);

    audit("franchise.wallet_top_up", {
      franchise_id,
      by_user_id: req.user.id,
      amount: moneyStr(amount),
      balance_after: moneyStr(transaction.balance_after),
      wallet_transaction_id: transaction.id,
    });

    ok(
      res,
      {
        wallet_transaction_id: transaction.id,
        amount: moneyStr(amount),
        wallet_balance: moneyStr(transaction.balance_after),
      },
      { status: 201 }
    );
  })
);

// GET /api/v1/admin/wallet-transactions — newest first.
router.get(
  "/wallet-transactions",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { limit, cursorId } = parsePagination(req.query);
    const [franchise, rows] = await Promise.all([
      prisma.franchise.findUnique({
        where: { id: req.franchise_id },
        select: { wallet_balance: true, min_balance_limit: true },
      }),
      prisma.walletTransaction.findMany({
        where: {
          franchise_id: req.franchise_id,
          ...(cursorId ? { id: { lt: cursorId } } : {}),
        },
        orderBy: { id: "desc" },
        take: limit + 1,
      }),
    ]);
    const page = buildPage(rows, limit);
    ok(
      res,
      {
        wallet_balance: moneyStr(franchise.wallet_balance),
        min_balance_limit: moneyStr(franchise.min_balance_limit),
        items: page.items.map((row) => ({
          id: row.id,
          order_id: row.order_id,
          type: row.type,
          amount: moneyStr(row.amount),
          balance_after: moneyStr(row.balance_after),
          description: row.description,
          created_at: row.created_at,
        })),
      },
      { pagination: page.pagination }
    );
  })
);

// GET /api/v1/admin/reconciliation?from=&to= — SPEC §41. Totals, payment
// split, order-level discrepancies and stored-balance-vs-ledger checks.
router.get(
  "/reconciliation",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    ok(res, await buildReconciliation(req.franchise_id, parseRange(req.query)));
  })
);

// GET /api/v1/admin/reconciliation/orders?from=&to=&limit=&cursor= — one
// page of delivered orders with the four-way split and their check result.
router.get(
  "/reconciliation/orders",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const range = parseRange(req.query);
    const { limit, cursorId } = parsePagination(req.query);
    const rows = await reconciliationOrders(req.franchise_id, range, { limit, cursorId });
    const page = buildPage(rows, limit);
    const checked = await checkOrders(page.items);
    ok(
      res,
      { orders: page.items.map((order) => orderRow(order, checked.get(order.id))) },
      { pagination: page.pagination }
    );
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin dashboard
// ─────────────────────────────────────────────────────────────────────────────

const franchiseSettingsView = (franchise) => ({
  id: franchise.id,
  name: franchise.name,
  slug: franchise.slug,
  is_active: franchise.is_active,
  wallet_balance: moneyStr(franchise.wallet_balance),
  min_balance_limit: moneyStr(franchise.min_balance_limit),
  royalty_per_order: moneyStr(franchise.royalty_per_order),
  default_commission_rate: moneyStr(franchise.default_commission_rate),
  rain_surge_fee: moneyStr(franchise.rain_surge_fee),
  max_delivery_km: moneyStr(franchise.max_delivery_km),
  daily_milestone_target: franchise.daily_milestone_target,
  daily_milestone_bonus: moneyStr(franchise.daily_milestone_bonus),
});

// GET /api/v1/admin/overview — settings, fleet positions, nightly ledger.
router.get(
  "/overview",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const franchise_id = req.franchise_id;
    const day = istDayRange();
    const now = new Date();
    const [franchise, riders, active, deliveredToday, openRequests, cashToday, stuckRows] =
      await Promise.all([
        prisma.franchise.findUnique({ where: { id: franchise_id } }),
        prisma.rider.findMany({
          where: { franchise_id },
          orderBy: { id: "asc" },
          include: { user: { select: { name: true, phone: true, is_active: true } } },
        }),
        prisma.order.groupBy({
          by: ["rider_id"],
          where: { franchise_id, order_status: { in: ACTIVE_ORDER_STATUSES } },
          _count: { _all: true },
        }),
        prisma.order.groupBy({
          by: ["rider_id"],
          where: {
            franchise_id,
            order_status: "DELIVERED",
            delivered_at: { gte: day.start, lt: day.end },
          },
          _count: { _all: true },
        }),
        prisma.order.count({ where: { franchise_id, order_status: "RIDER_REQUESTED" } }),
        prisma.settlementEntry.groupBy({
          by: ["rider_id"],
          where: {
            franchise_id,
            party: "RIDER_CASH",
            created_at: { gte: day.start, lt: day.end },
          },
          _sum: { amount: true },
        }),
        // Orders that need a human: nobody has taken them, or a rider has held them for hours.
        prisma.order.findMany({
          where: {
            franchise_id,
            OR: [
              {
                order_status: "RIDER_REQUESTED",
                created_at: { lt: minutesAgo(now, staleRules.redispatchAfterMinutes) },
              },
              {
                order_status: { in: ACTIVE_ORDER_STATUSES },
                created_at: { lt: minutesAgo(now, staleRules.stuckActiveAfterMinutes) },
              },
            ],
          },
          orderBy: { created_at: "asc" },
          take: 50,
          select: {
            id: true,
            order_number: true,
            order_status: true,
            created_at: true,
            custom_shop_name: true,
            vendor: { select: { shop_name: true } },
            rider: { select: { user: { select: { name: true } } } },
          },
        }),
      ]);
    const stuck_orders = stuckRows.map((row) => ({
      id: row.id,
      order_number: row.order_number,
      order_status: row.order_status,
      shop_name: row.vendor?.shop_name ?? row.custom_shop_name ?? null,
      rider_name: row.rider?.user.name ?? null,
      age_minutes: Math.floor((now.getTime() - row.created_at.getTime()) / 60_000),
    }));
    const count = (rows, riderId) =>
      rows.find((row) => row.rider_id === riderId)?._count._all ?? 0;

    ok(res, {
      franchise: franchiseSettingsView(franchise),
      date: day.date,
      open_requests: openRequests,
      stuck_orders,
      riders: riders.map((rider) => ({
        id: rider.id,
        name: rider.user.name,
        phone: rider.user.phone,
        is_active: rider.user.is_active,
        is_online: rider.is_online,
        is_approved: rider.is_approved,
        vehicle_type: rider.vehicle_type,
        vehicle_number: rider.vehicle_number,
        cash_in_hand: moneyStr(rider.cash_in_hand),
        max_cash_limit: moneyStr(rider.max_cash_limit),
        // At the limit a rider cannot accept orders or go online (§15).
        is_cash_locked: isCashLocked(rider),
        wallet_earnings: moneyStr(rider.wallet_earnings),
        // + rider owes the franchise, − the franchise owes the rider (§15.2).
        net_due: moneyStr(netDue(rider)),
        active_orders: count(active, rider.id),
        delivered_today: count(deliveredToday, rider.id),
        cash_collected_today: moneyStr(
          cashToday.find((row) => row.rider_id === rider.id)?._sum.amount ?? 0
        ),
        lat: coordStr(rider.current_lat),
        lng: coordStr(rider.current_lng),
        last_location_at: rider.last_location_at,
      })),
    });
  })
);

// PATCH /api/v1/admin/franchise/settings — rain surge and the delivery radius.
// ─────────────────────────────────────────────────────────────────────────────
// Delivery zones: distance bands (hotel -> customer). SPEC "Delivery zones by distance".
// ─────────────────────────────────────────────────────────────────────────────

const km2 = (value) => (Math.round(Number(value) * 100) / 100).toFixed(2);

const zoneView = (zone) => ({
  id: zone.id,
  zone_name: zone.zone_name,
  max_km: moneyStr(zone.max_km),
  delivery_fee: moneyStr(zone.delivery_fee),
});

const zoneFields = {
  zone_name: z.string().trim().min(2).max(80),
  max_km: z.coerce.number().min(0.5).max(50),
  delivery_fee: zMoney,
};
const zoneCreateSchema = z.object(zoneFields);
const zoneUpdateSchema = z
  .object(zoneFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" });

/** Two bands cannot end at the same distance, and a name is unique per franchise. */
async function checkZone(franchise_id, { zone_name, max_km }, exceptId) {
  const others = await prisma.zone.findMany({ where: { franchise_id, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (zone_name !== undefined && others.some((z) => z.zone_name.toLowerCase() === zone_name.toLowerCase())) {
    throw new AppError(409, "DUPLICATE_ZONE", "A zone with this name already exists");
  }
  if (max_km !== undefined && others.some((z) => Number(z.max_km) === Number(km2(max_km)))) {
    throw new AppError(409, "DUPLICATE_BAND", "Another zone already ends at this distance");
  }
}

router.get(
  "/zones",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const zones = await prisma.zone.findMany({
      where: { franchise_id: req.franchise_id },
      orderBy: [{ max_km: "asc" }, { id: "asc" }],
    });
    ok(res, { zones: zones.map(zoneView) });
  })
);

router.post(
  "/zones",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = parse(zoneCreateSchema, req.body);
    await checkZone(req.franchise_id, body);
    const zone = await prisma.zone.create({
      data: {
        franchise_id: req.franchise_id,
        zone_name: body.zone_name,
        max_km: km2(body.max_km),
        delivery_fee: moneyStr(body.delivery_fee),
      },
    });
    audit("zone.created", { franchise_id: req.franchise_id, by_user_id: req.user.id, zone_id: zone.id });
    ok(res, { zone: zoneView(zone) }, { status: 201 });
  })
);

router.patch(
  "/zones/:id",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const body = parse(zoneUpdateSchema, req.body);
    const current = await prisma.zone.findFirst({ where: { id, franchise_id: req.franchise_id } });
    if (!current) throw new AppError(404, "NOT_FOUND", "Zone not found");
    await checkZone(req.franchise_id, body, id);
    const zone = await prisma.zone.update({
      where: { id },
      data: {
        ...(body.zone_name !== undefined ? { zone_name: body.zone_name } : {}),
        ...(body.max_km !== undefined ? { max_km: km2(body.max_km) } : {}),
        ...(body.delivery_fee !== undefined ? { delivery_fee: moneyStr(body.delivery_fee) } : {}),
      },
    });
    audit("zone.updated", {
      franchise_id: req.franchise_id,
      by_user_id: req.user.id,
      zone_id: id,
      before: zoneView(current),
      after: zoneView(zone),
    });
    ok(res, { zone: zoneView(zone) });
  })
);

router.delete(
  "/zones/:id",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const zone = await prisma.zone.findFirst({ where: { id, franchise_id: req.franchise_id } });
    if (!zone) throw new AppError(404, "NOT_FOUND", "Zone not found");
    if ((await prisma.zone.count({ where: { franchise_id: req.franchise_id } })) <= 1) {
      throw new AppError(409, "LAST_ZONE", "Keep at least one zone");
    }
    if ((await prisma.order.count({ where: { franchise_id: req.franchise_id, zone_id: id } })) > 0) {
      throw new AppError(409, "ZONE_IN_USE", "Orders were delivered in this zone, so it cannot be deleted. Edit it instead.");
    }
    await prisma.zone.delete({ where: { id } });
    audit("zone.deleted", { franchise_id: req.franchise_id, by_user_id: req.user.id, zone_id: id });
    ok(res, { id });
  })
);

const settingsSchema = z
  .object({
    rain_surge_fee: zMoney.optional(),
    // Orders further than this from the hotel are refused (SPEC "Delivery zones by distance").
    max_delivery_km: z.coerce.number().min(0.5).max(50).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to update" })
  .refine((body) => body.rain_surge_fee === undefined || Number(body.rain_surge_fee) <= 200, {
    message: "rain_surge_fee must be at most 200",
    path: ["rain_surge_fee"],
  });

router.patch(
  "/franchise/settings",
  requireRole("FRANCHISE_ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = parse(settingsSchema, req.body);
    const before = await prisma.franchise.findUnique({ where: { id: req.franchise_id } });
    const franchise = await prisma.franchise.update({
      where: { id: req.franchise_id },
      data: {
        ...(body.rain_surge_fee !== undefined
          ? { rain_surge_fee: moneyStr(body.rain_surge_fee) }
          : {}),
        ...(body.max_delivery_km !== undefined ? { max_delivery_km: km2(body.max_delivery_km) } : {}),
      },
    });
    audit("franchise.settings", {
      franchise_id: req.franchise_id,
      by_user_id: req.user.id,
      before: {
        rain_surge_fee: moneyStr(before.rain_surge_fee),
        max_delivery_km: moneyStr(before.max_delivery_km),
      },
      after: {
        rain_surge_fee: moneyStr(franchise.rain_surge_fee),
        max_delivery_km: moneyStr(franchise.max_delivery_km),
      },
    });
    emitTo(rooms.franchise(req.franchise_id), "franchise_settings_changed", {
      rain_surge_fee: moneyStr(franchise.rain_surge_fee),
    });
    ok(res, { franchise: franchiseSettingsView(franchise) });
  })
);

export default router;
