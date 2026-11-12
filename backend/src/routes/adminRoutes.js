// /api/v1/admin — rider cash settlement and franchise wallet top-up.
//
// The tenant always comes from x-franchise-slug. A FRANCHISE_ADMIN can only
// act on their own franchise (enforced in `authenticate`); the global
// SUPER_ADMIN acts on whichever franchise the header selects.

import { Router } from "express";
import { z } from "zod";
import { prisma, TX_OPTIONS } from "../config/prisma.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { audit } from "../utils/audit.js";
import { addMoney, money, subtractMoney } from "../utils/orderMath.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { AppError, asyncHandler, ok, validationError } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { parse, parseId, zMoney } from "../utils/validate.js";

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

export default router;
