// /api/v1/whatsapp — the Meta Cloud API webhook (SPEC "WhatsApp ordering"),
// plus a development simulator. Mounted outside resolveTenant: the franchise is
// found from the business phone-number id Meta puts in every event.

import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { handleInbound } from "../services/whatsapp/flow.js";
import { drainOutbox } from "../services/whatsapp/client.js";
import { parseWebhook, processInbound } from "../services/whatsapp/inbound.js";
import { AppError, asyncHandler, fieldError, ok } from "../utils/response.js";
import { parse } from "../utils/validate.js";

const router = Router();

function validSignature(req) {
  const secret = env.whatsapp.appSecret;
  // No secret configured: tolerated in development only.
  if (!secret) return !env.isProduction;
  const header = String(req.get("x-hub-signature-256") || "");
  if (!req.rawBody || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  const given = header.slice(7);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// GET /api/v1/whatsapp/webhook — Meta's one-time verification handshake.
router.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && env.whatsapp.verifyToken && token === env.whatsapp.verifyToken) {
    return res.status(200).type("text/plain").send(String(challenge));
  }
  return res.status(403).type("text/plain").send("forbidden");
});

// POST /api/v1/whatsapp/webhook — customer messages. Answer fast, work after.
router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    if (!validSignature(req)) throw new AppError(401, "UNAUTHENTICATED", "Bad signature");
    res.status(200).json({ received: true });

    const messages = parseWebhook(req.body);
    for (const inbound of messages) {
      if (!inbound.phone_number_id) continue;
      const franchise = await prisma.franchise.findFirst({
        where: { whatsapp_phone_number_id: inbound.phone_number_id, whatsapp_enabled: true, is_active: true },
      });
      if (franchise) void processInbound(franchise, inbound);
    }
  })
);

// ── Development simulator (never available in production) ───────────────────
if (!env.isProduction) {
  const simSchema = z.object({
    from: z.union([z.string(), z.number()]).transform(String),
    franchise_slug: z.string().optional(),
    text: z.string().optional(),
    button_id: z.string().optional(),
    list_id: z.string().optional(),
    location: z.object({ lat: z.number(), lng: z.number() }).optional(),
    name: z.string().optional(),
  });

  // POST /api/v1/whatsapp/dev/simulate — play one customer message, get the bot's replies.
  router.post(
    "/dev/simulate",
    asyncHandler(async (req, res) => {
      const body = parse(simSchema, req.body);
      const slug = body.franchise_slug || env.defaultFranchiseSlug;
      const franchise = slug ? await prisma.franchise.findUnique({ where: { slug } }) : null;
      if (!franchise) throw fieldError("franchise_slug", "franchise not found");
      const id = body.button_id || body.list_id;
      const message = body.location
        ? { type: "location", location: body.location }
        : id
          ? { type: body.button_id ? "button" : "list", id }
          : { type: "text", text: body.text ?? "" };
      const replies = await handleInbound({ franchise, wa_id: body.from, name: body.name, message });
      ok(res, { replies });
    })
  );

  // GET /api/v1/whatsapp/dev/outbox?to=919847000001 — status updates the bot "sent" (and clears them).
  router.get(
    "/dev/outbox",
    asyncHandler(async (req, res) => {
      ok(res, { messages: drainOutbox(String(req.query.to || "")) });
    })
  );
}

export default router;
