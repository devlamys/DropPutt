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
import { addMoney, money, subtractMoney } from "../utils/orderMath.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { AppError, asyncHandler, ok, validationError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
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
    const franchise_id = req.franchise_id;
    const body = parse(cashSettlementSchema, req.body);
    const amount = money(body.amount);

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`
        SELECT id FROM "riders"
        WHERE id = ${riderId} AND franchise_id = ${franchise_id}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found in this franchise");
      }
      const rider = await tx.rider.findUnique({ where: { id: riderId } });
      if (amount.gt(rider.cash_in_hand)) {
        throw validationError("Request validation failed", [
          {
            field: "amount",
            issue: `exceeds rider cash in hand (₹${moneyStr(rider.cash_in_hand)})`,
          },
        ]);
      }

      const cash_after = subtractMoney(rider.cash_in_hand, amount);
      await tx.rider.update({
        where: { id: riderId },
        data: { cash_in_hand: moneyStr(cash_after) },
      });
      return { cash_before: moneyStr(rider.cash_in_hand), cash_after: moneyStr(cash_after) };
    }, TX_OPTIONS);

    audit("rider.cash_settlement", {
      franchise_id,
      rider_id: riderId,
      settled_by_user_id: req.user.id,
      amount: moneyStr(amount),
      note: body.note ?? null,
      request_id: res.locals.request_id,
      ...result,
    });

    ok(res, {
      rider_id: riderId,
      amount_settled: moneyStr(amount),
      cash_in_hand_before: result.cash_before,
      cash_in_hand: result.cash_after,
    });
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
  is_launch_promo_active: franchise.is_launch_promo_active,
  rain_surge_fee: moneyStr(franchise.rain_surge_fee),
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
        is_cash_locked: rider.cash_in_hand.gte(rider.max_cash_limit),
        wallet_earnings: moneyStr(rider.wallet_earnings),
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

// PATCH /api/v1/admin/franchise/settings — launch promo and rain surge.
const settingsSchema = z
  .object({
    is_launch_promo_active: z.boolean().optional(),
    rain_surge_fee: zMoney.optional(),
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
        ...(body.is_launch_promo_active !== undefined
          ? { is_launch_promo_active: body.is_launch_promo_active }
          : {}),
        ...(body.rain_surge_fee !== undefined
          ? { rain_surge_fee: moneyStr(body.rain_surge_fee) }
          : {}),
      },
    });
    audit("franchise.settings", {
      franchise_id: req.franchise_id,
      by_user_id: req.user.id,
      before: {
        is_launch_promo_active: before.is_launch_promo_active,
        rain_surge_fee: moneyStr(before.rain_surge_fee),
      },
      after: {
        is_launch_promo_active: franchise.is_launch_promo_active,
        rain_surge_fee: moneyStr(franchise.rain_surge_fee),
      },
    });
    emitTo(rooms.franchise(req.franchise_id), "franchise_settings_changed", {
      is_launch_promo_active: franchise.is_launch_promo_active,
      rain_surge_fee: moneyStr(franchise.rain_surge_fee),
    });
    ok(res, { franchise: franchiseSettingsView(franchise) });
  })
);

export default router;
