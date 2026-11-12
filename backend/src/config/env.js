// Central environment configuration. Import this before anything that
// reads process.env.

import crypto from "node:crypto";

try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the real environment.
}

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

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
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0,
  enableCron: process.env.ENABLE_CRON !== "false",
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  r2: {
    endpoint: process.env.R2_ENDPOINT || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET_NAME || "",
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  },
});
