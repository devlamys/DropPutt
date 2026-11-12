// /api/v1/customers — staff-created customers (SPEC §49.2, phase 1).

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { normalizePhone } from "../utils/phone.js";
import { AppError, asyncHandler, ok, validationError } from "../utils/response.js";
import { parse } from "../utils/validate.js";

const router = Router();
router.use(authenticate, requireRole("FRANCHISE_ADMIN", "VENDOR"));

const schema = z.object({
  phone: z.union([z.string(), z.number()]),
  name: z.string().trim().min(1).max(100).optional(),
  franchise_slug: z.string().max(63).optional(),
});

// POST /api/v1/customers
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parse(schema, req.body);
    // The tenant is the resolved franchise; a body slug may only confirm it.
    if (body.franchise_slug && body.franchise_slug.toLowerCase() !== req.franchise.slug) {
      throw validationError("Request validation failed", [
        { field: "franchise_slug", issue: "does not match the request franchise" },
      ]);
    }
    const phone = normalizePhone(body.phone);
    if (!phone) {
      throw validationError("Request validation failed", [
        { field: "phone", issue: "must be a valid 10-digit mobile number" },
      ]);
    }
    const exists = await prisma.customer.findUnique({
      where: { franchise_id_phone: { franchise_id: req.franchise_id, phone } },
      select: { id: true },
    });
    if (exists) {
      throw new AppError(409, "CUSTOMER_EXISTS", "Customer already registered", [
        { field: "phone", issue: "already exists in this franchise" },
      ]);
    }
    const customer = await prisma.customer.create({
      data: { franchise_id: req.franchise_id, phone, name: body.name ?? null },
    });
    ok(
      res,
      { id: customer.id, phone: customer.phone, name: customer.name, created_at: customer.created_at },
      { status: 201 }
    );
  })
);

export default router;
