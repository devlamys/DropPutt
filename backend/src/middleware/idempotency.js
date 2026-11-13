// Idempotency-Key support (SPEC §50.4): the first successful response for a
// key is cached for 24 hours and replayed for retries.
//
// The stored key is a hash of tenant + actor + route + client key, so one
// client's key can never replay another client's response.

import crypto from "node:crypto";
import { prisma } from "../config/prisma.js";
import { AppError, asyncHandler, validationError } from "../utils/response.js";

const TTL_MS = 24 * 60 * 60 * 1000;
// A "pending" record older than this is treated as a crashed request. If the
// final save failed repeatedly, a retry after this window can re-run the handler.
const PENDING_STALE_MS = 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export function idempotency() {
  return asyncHandler(async (req, res, next) => {
    const clientKey = req.get("idempotency-key");
    if (!clientKey) return next();
    if (!KEY_PATTERN.test(clientKey)) {
      throw validationError("Request validation failed", [
        { field: "Idempotency-Key", issue: "must be 8-128 characters: letters, digits or hyphens" },
      ]);
    }

    const actor = req.user
      ? `user:${req.user.id}`
      : `public:${req.params.token ?? req.ip}`;
    const key = crypto
      .createHash("sha256")
      .update(
        [
          req.franchise_id ?? "-",
          actor,
          req.method,
          req.originalUrl.split("?")[0],
          clientKey,
        ].join("|")
      )
      .digest("hex");

    const now = new Date();
    const fresh = {
      franchise_id: req.franchise_id ?? null,
      user_id: req.user?.id ?? null,
      response: { pending: true },
      created_at: now,
      expires_at: new Date(now.getTime() + TTL_MS),
    };

    let claimed = false;
    try {
      await prisma.idempotencyRecord.create({ data: { key, ...fresh } });
      claimed = true;
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }

    if (!claimed) {
      const existing = await prisma.idempotencyRecord.findUnique({ where: { key } });
      const pending = existing?.response?.pending === true;
      const reusable =
        !existing ||
        existing.expires_at <= now ||
        (pending && now.getTime() - existing.created_at.getTime() > PENDING_STALE_MS);

      if (reusable) {
        await prisma.idempotencyRecord.upsert({
          where: { key },
          update: fresh,
          create: { key, ...fresh },
        });
      } else if (pending) {
        throw new AppError(
          409,
          "IDEMPOTENCY_IN_PROGRESS",
          "A request with this Idempotency-Key is still being processed"
        );
      } else {
        const { status, body } = existing.response;
        if (body?.meta?.request_id) {
          res.setHeader("X-Request-ID", body.meta.request_id);
        }
        res.setHeader("Idempotent-Replayed", "true");
        return res.status(status).json(body);
      }
    }

    // Cache the response once the handler produces it. Only successes are
    // kept; a failed attempt releases the key so the client can retry.
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      const success = res.statusCode >= 200 && res.statusCode < 300;
      const status = res.statusCode;
      const persist = () =>
        success
          ? prisma.idempotencyRecord.update({
              where: { key },
              data: { response: { status, body } },
            })
          : prisma.idempotencyRecord.deleteMany({ where: { key } });
      // Retry briefly: a record left "pending" blocks the client's retry with
      // a 409 and, after PENDING_STALE_MS, lets the handler run a second time.
      (async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await persist();
            return;
          } catch (error) {
            if (attempt === 2) {
              console.error(
                `[idempotency] failed to persist record ${key.slice(0, 12)}:`,
                error.message
              );
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 100 * 3 ** attempt));
          }
        }
      })().finally(() => sendJson(body));
      return res;
    };

    next();
  });
}
