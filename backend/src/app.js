// Express application (no listening socket — see server.js).

import path from "node:path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { getRedis } from "./config/redis.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requireHttps } from "./middleware/requireHttps.js";
import { requestContext } from "./middleware/requestContext.js";
import { resolveTenant } from "./middleware/resolveTenant.js";
import adminRoutes from "./routes/adminRoutes.js";
import { appVersionGate } from "./middleware/appVersion.js";
import authRoutes from "./routes/authRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import riderRoutes from "./routes/riderRoutes.js";
import superRoutes from "./routes/superRoutes.js";
import vendorRoutes from "./routes/vendorRoutes.js";
import marketplaceRoutes from "./routes/marketplaceRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import { fail, ok } from "./utils/response.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  if (env.trustProxy) app.set("trust proxy", env.trustProxy);

  app.use(requestContext);
  if (env.requireHttps) app.use(requireHttps);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      // Explicit allow-list in production; any origin in local development.
      origin: env.corsOrigins.length ? env.corsOrigins : !env.isProduction,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-franchise-slug",
        "Idempotency-Key",
        "X-App-Version",
        "X-App-Platform",
      ],
      exposedHeaders: ["X-Request-ID", "Retry-After"],
    })
  );
  app.use(express.json({ limit: "100kb" }));

  // Local-disk uploads are a development fallback only (production uses R2).
  if (!env.isProduction) {
    app.use("/uploads", express.static(path.resolve(env.uploadDir)));
  }

  app.use("/api", appVersionGate);

  // Liveness: the process is up. Readiness: it can reach what it needs.
  app.get("/health", (req, res) => ok(res, { status: "ok" }));
  app.get("/ready", async (req, res) => {
    const checks = { database: false, redis: env.redisUrl ? false : null };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      /* reported below */
    }
    if (env.redisUrl) checks.redis = Boolean(getRedis());
    const ready = checks.database && checks.redis !== false;
    if (ready) return ok(res, { status: "ready", checks });
    return fail(res, 503, "NOT_READY", "Service is not ready", [checks]);
  });

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/public", publicRoutes); // tenant derived from the token
  app.use("/api/v1/orders", resolveTenant, orderRoutes);
  app.use("/api/v1/marketplace", resolveTenant, marketplaceRoutes);
  app.use("/api/v1/admin", resolveTenant, adminRoutes);
  app.use("/api/v1/device", deviceRoutes); // owner from JWT or Magic Link token
  app.use("/api/v1/customers", resolveTenant, customerRoutes);
  app.use("/api/v1/rider", resolveTenant, riderRoutes);
  app.use("/api/v1/riders", resolveTenant, riderRoutes); // SPEC §52.1 spelling
  app.use("/api/v1/vendor", resolveTenant, vendorRoutes);
  app.use("/api/v1/super", superRoutes); // cross-franchise, Super Admin only

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
