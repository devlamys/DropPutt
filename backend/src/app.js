// Express application (no listening socket — see server.js).

import path from "node:path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestContext } from "./middleware/requestContext.js";
import { resolveTenant } from "./middleware/resolveTenant.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import marketplaceRoutes from "./routes/marketplaceRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import { ok } from "./utils/response.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  if (env.trustProxy) app.set("trust proxy", env.trustProxy);

  app.use(requestContext);
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
      ],
      exposedHeaders: ["X-Request-ID", "Retry-After"],
    })
  );
  app.use(express.json({ limit: "100kb" }));

  // Local-disk uploads are a development fallback only (production uses R2).
  if (!env.isProduction) {
    app.use("/uploads", express.static(path.resolve(env.uploadDir)));
  }

  app.get("/health", (req, res) => ok(res, { status: "ok" }));

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/public", publicRoutes); // tenant derived from the token
  app.use("/api/v1/orders", resolveTenant, orderRoutes);
  app.use("/api/v1/marketplace", resolveTenant, marketplaceRoutes);
  app.use("/api/v1/admin", resolveTenant, adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
