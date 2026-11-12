// Central environment configuration. Import this before anything that
// reads process.env.

import crypto from "node:crypto";

// process.loadEnvFile() was added in Node 20.12. Failing loudly beats
// silently ignoring .env on an older runtime.
if (typeof process.loadEnvFile !== "function") {
  throw new Error(
    `Node.js 20.12 or newer is required (running ${process.version}).`
  );
}
try {
  process.loadEnvFile();
} catch (error) {
  // A missing .env is fine (real environment variables are used instead);
  // an unreadable or malformed one is not.
  if (error?.code !== "ENOENT") throw error;
}

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

if (isProduction && process.env.TRUST_PROXY === undefined) {
  console.warn(
    "[env] TRUST_PROXY is not set. Behind Nginx/Cloudflare every client then looks like one IP, so IP rate limits would throttle all users together. Set TRUST_PROXY to the number of proxies in front of the API (0 if none)."
  );
}

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (isProduction) {
    throw new Error("JWT_SECRET must be set to at least 32 characters in production");
  }
  console.warn(
    "[env] JWT_SECRET missing or shorter than 32 chars — using a random per-process secret (dev only; tokens die on restart)."
  );
  return crypto.randomBytes(48).toString("hex");
}

function list(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env = Object.freeze({
  NODE_ENV,
  isProduction,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: resolveJwtSecret(),
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 30,
  // Used when x-franchise-slug is absent. Never applied in production.
  defaultFranchiseSlug: isProduction
    ? null
    : process.env.DEFAULT_FRANCHISE_SLUG || "kizhissery",
  // Slug that selects the global Super Admin on login (admin.techkerala.in).
  adminSlug: "admin",
  corsOrigins: list(process.env.CORS_ORIGINS),
  // Reject plain-HTTP requests (SPEC §37.11). On by default in production;
  // set REQUIRE_HTTPS=false only if TLS is terminated before a proxy that
  // cannot forward X-Forwarded-Proto.
  requireHttps: isProduction && process.env.REQUIRE_HTTPS !== "false",
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0,
  enableCron: process.env.ENABLE_CRON !== "false",
  // Shared state for several API replicas: Socket.io adapter + GPS replay
  // protection. Optional with a single instance.
  redisUrl: process.env.REDIS_URL || "",
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",
  // Native-app version gate (SPEC §54.2). Unset = no minimum enforced.
  minAppVersion: {
    android: process.env.MIN_APP_VERSION_ANDROID || process.env.MIN_APP_VERSION || "",
    ios: process.env.MIN_APP_VERSION_IOS || process.env.MIN_APP_VERSION || "",
  },
  appStoreUrl: {
    android: process.env.APP_STORE_URL_ANDROID || "",
    ios: process.env.APP_STORE_URL_IOS || "",
  },
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  r2: {
    endpoint: process.env.R2_ENDPOINT || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET_NAME || "",
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  },
});
