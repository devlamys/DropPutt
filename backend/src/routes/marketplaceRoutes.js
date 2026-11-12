// /api/v1/marketplace — franchise-scoped feed (SPEC §26, §40).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { CHAYAKADI_LABEL, SNACK_MIN_ORDER_VALUE } from "../utils/constants.js";
import { buildPage, parsePagination } from "../utils/pagination.js";
import { asyncHandler, ok } from "../utils/response.js";
import { moneyStr } from "../utils/serializers.js";
import { isProductInSlot } from "../utils/slots.js";
import { isChayakadiWindow, istMinutesOfDay } from "../utils/time.js";
import { parse } from "../utils/validate.js";

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
        products: {
          where: { is_available: true },
          orderBy: [{ is_combo: "desc" }, { id: "asc" }],
        },
      },
    });
    const page = buildPage(vendors, limit);

    const items = page.items.map((vendor) => {
      const products = vendor.products.filter((product) => isProductInSlot(product, minutes));
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

export default router;
