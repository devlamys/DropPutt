// /api/v1/vendor — the signed-in vendor's shop and menu (Vendor app).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { AppError, asyncHandler, forbidden, ok } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { parse, parseId } from "../utils/validate.js";

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
          select: { order_number: true, payment_method: true, item_total: true, delivered_at: true },
        },
      },
    });
    const page = buildPage(rows, limit);
    ok(
      res,
      {
        admin_payable_balance: moneyStr(req.vendor.admin_payable_balance),
        items: page.items.map((row) => ({
          id: row.id,
          order_number: row.order.order_number,
          payment_method: row.order.payment_method,
          item_total: moneyStr(row.order.item_total),
          amount: moneyStr(row.amount),
          delivered_at: row.order.delivered_at,
          created_at: row.created_at,
        })),
      },
      { pagination: page.pagination }
    );
  })
);

export default router;
