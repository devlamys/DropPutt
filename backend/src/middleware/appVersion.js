// Native-app version gate (SPEC §54.2). Web clients omit X-App-Version and
// are never blocked; native builds send "<semver>" and, optionally,
// X-App-Platform: android | ios.

import { env } from "../config/env.js";
import { AppError } from "../utils/response.js";

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? "").trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

export function isOlder(version, minimum) {
  const a = parse(version);
  const b = parse(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

export function appVersionGate(req, res, next) {
  const version = req.get("x-app-version");
  if (!version) return next();

  const platform = String(req.get("x-app-platform") || "android").toLowerCase();
  const key = platform === "ios" ? "ios" : "android";
  const minimum = env.minAppVersion[key];
  if (minimum && isOlder(version, minimum)) {
    return next(
      new AppError(403, "APP_UPDATE_REQUIRED", "Please update the app to continue.", [
        { min_version: minimum, store_url: env.appStoreUrl[key] || null },
      ])
    );
  }
  next();
}
