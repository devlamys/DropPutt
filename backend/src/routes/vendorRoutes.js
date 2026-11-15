// /api/v1/vendor — the signed-in vendor's shop and menu (Vendor app).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { AppError, asyncHandler, forbidden, ok } from "../utils/response.js";
import { isCommissionFreeOrder, moneyStr } from "../utils/serializers.js";
import { parse, parseId, zId, zMoney } from "../utils/validate.js";
import { settlementView } from "../services/vendorSettlementService.js";
import { idempotency } from "../middleware/idempotency.js";
import { money } from "../utils/orderMath.js";
import {
  cashOwedByVendor,
  createHandover,
  handoverInclude,
  handoverView,
  resolveHandover,
} from "../services/cashHandoverService.js";

const router = Router();
router.use(authenticate, requireRole("VENDOR"));

const loadVendor = asyncHandler(async (req, res, next) => {
  const vendor = await prisma.vendor.findFirst({
    where: { user_id: req.user.id, franchise_id: req.franchise_id },
  });
  if (!vendor) throw forbidden("Vendor profile not found in this franchise");
  req.vendor = vendor;
  next();
});
router.use(loadVendor);

const shopView = (vendor) => ({
  id: vendor.id,
  shop_name: vendor.shop_name,
  shop_category: vendor.shop_category,
  address: vendor.address,
  is_open: vendor.is_open,
  min_order_value: moneyStr(vendor.min_order_value),
  // Call Rider Now free trial (§10.1): no commission until this moment.
  commission_free_until: vendor.commission_free_until,
  trial_active: Boolean(vendor.commission_free_until) && vendor.commission_free_until > new Date(),
});

const productView = (product) => ({
  id: product.id,
  name: product.name,
  price: moneyStr(product.price),
  image_url: product.image_url,
  slot_type: product.slot_type,
  is_combo: product.is_combo,
  is_available: product.is_available,
});

// GET /api/v1/vendor/me — shop plus full menu.
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const products = await prisma.product.findMany({
      where: { vendor_id: req.vendor.id },
      orderBy: [{ is_combo: "desc" }, { id: "asc" }],
    });
    ok(res, { shop: shopView(req.vendor), products: products.map(productView) });
  })
);

const toggleSchema = z.object({ is_available: z.boolean() });

// PATCH /api/v1/vendor/products/:id — menu availability toggle.
router.patch(
  "/products/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const { is_available } = parse(toggleSchema, req.body);
    // vendor_id in the filter keeps a vendor inside their own menu.
    const { count } = await prisma.product.updateMany({
      where: { id, vendor_id: req.vendor.id },
      data: { is_available },
    });
    if (count === 0) throw new AppError(404, "NOT_FOUND", "Product not found");
    const product = await prisma.product.findUnique({ where: { id } });
    ok(res, { product: productView(product) });
  })
);

const openSchema = z.object({ is_open: z.boolean() });

// PATCH /api/v1/vendor/shop — open / close the whole shop.
router.patch(
  "/shop",
  asyncHandler(async (req, res) => {
    const { is_open } = parse(openSchema, req.body);
    const vendor = await prisma.vendor.update({
      where: { id: req.vendor.id },
      data: { is_open },
    });
    ok(res, { shop: shopView(vendor) });
  })
);

// GET /api/v1/vendor/ledger — what the platform owes the shop (or the shop
// owes the platform), one row per delivered order, newest first.
//   Positive = platform owes the shop; negative = shop owes the platform
//   (e.g. commission on an order the shop was paid for directly).
router.get(
  "/ledger",
  asyncHandler(async (req, res) => {
    const { limit, cursorId } = parsePagination(req.query);
    const rows = await prisma.settlementEntry.findMany({
      where: {
        franchise_id: req.franchise_id,
        vendor_id: req.vendor.id,
        party: "VENDOR_PAYABLE",
        ...(cursorId ? { id: { lt: cursorId } } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      include: {
        order: {
          select: {
            order_number: true,
            vendor_id: true,
            commission_rate: true,
            payment_method: true,
            item_total: true,
            vendor_commission: true,
            delivered_at: true,
          },
        },
      },
    });
    const page = buildPage(rows, limit);
    const settlements = await prisma.vendorSettlement.findMany({
      where: { franchise_id: req.franchise_id, vendor_id: req.vendor.id },
      orderBy: { id: "desc" },
      take: 20,
    });
    ok(
      res,
      {
        admin_payable_balance: moneyStr(req.vendor.admin_payable_balance),
        settlements: settlements.map(settlementView),
        items: page.items.map((row) => ({
          id: row.id,
          order_number: row.order.order_number,
          payment_method: row.order.payment_method,
          item_total: moneyStr(row.order.item_total),
          commission: moneyStr(row.order.vendor_commission),
          commission_free: isCommissionFreeOrder({ ...row.order }),
          amount: moneyStr(row.amount),
          delivered_at: row.order.delivered_at,
          created_at: row.created_at,
        })),
      },
      { pagination: page.pagination }
    );
  })
);

// GET /api/v1/vendor/cash-handovers?status=PENDING — cash riders say they
// paid this shop. Pending ones need one tap: confirm or "not received".
router.get(
  "/cash-handovers",
  asyncHandler(async (req, res) => {
    const status = ["PENDING", "CONFIRMED", "REJECTED"].includes(req.query.status)
      ? req.query.status
      : undefined;
    const rows = await prisma.riderCashHandover.findMany({
      where: { franchise_id: req.franchise_id, vendor_id: req.vendor.id, ...(status ? { status } : {}) },
      orderBy: { id: "desc" },
      take: 30,
      include: handoverInclude,
    });
    ok(res, { items: rows.map(handoverView) });
  })
);

// GET /api/v1/vendor/cash-riders — riders currently holding cash from this
// shop's orders, for the vendor-started "collect cash" shortcut.
router.get(
  "/cash-riders",
  asyncHandler(async (req, res) => {
    const riders = await prisma.rider.findMany({
      where: { franchise_id: req.franchise_id, cash_in_hand: { gt: 0 } },
      select: { id: true, cash_in_hand: true, user: { select: { name: true } } },
      orderBy: { cash_in_hand: "desc" },
      take: 100,
    });
    const items = [];
    for (const rider of riders) {
      const owed = (await cashOwedByVendor(prisma, req.franchise_id, rider.id)).find(
        (row) => row.vendor_id === req.vendor.id
      );
      if (!owed) continue;
      const cap = owed.owed.gt(rider.cash_in_hand) ? money(rider.cash_in_hand) : owed.owed;
      items.push({ rider_id: rider.id, rider_name: rider.user.name, owed: moneyStr(cap) });
    }
    ok(res, { items });
  })
);

const vendorCollectSchema = z.object({
  rider_id: zId,
  amount: zMoney.refine((value) => Number(value) > 0, { message: "must be greater than 0" }),
});

// POST /api/v1/vendor/cash-handovers — the vendor records cash received
// from a rider; applied immediately (the vendor is the receiver).
router.post(
  "/cash-handovers",
  idempotency(),
  asyncHandler(async (req, res) => {
    const body = parse(vendorCollectSchema, req.body);
    const row = await createHandover(
      {
        franchise: req.franchise,
        rider_id: body.rider_id,
        vendor_id: req.vendor.id,
        amount: body.amount,
        initiated_by: "VENDOR",
        user_id: req.user.id,
      },
      { requestId: res.locals.request_id }
    );
    ok(res, { handover: handoverView(row) }, { status: 201 });
  })
);

for (const action of ["confirm", "reject"]) {
  router.post(
    `/cash-handovers/:id/${action}`,
    asyncHandler(async (req, res) => {
      const row = await resolveHandover(
        {
          franchise: req.franchise,
          handover_id: parseId(req.params.id),
          action,
          vendor_id: req.vendor.id,
          user_id: req.user.id,
        },
        { requestId: res.locals.request_id }
      );
      ok(res, { handover: handoverView(row) });
    })
  );
}

export default router;
