// Housekeeping jobs (SPEC §51.4 and §50.4). All times are Asia/Kolkata.
//
// Every job is an idempotent DELETE, so running on several replicas is
// harmless (ENABLE_CRON=false still limits it to one).

import cron from "node-cron";
import { prisma } from "../config/prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Dead device registrations are kept this long for diagnostics (§51.4).
const STALE_DEVICE_DAYS = 90;
// Expired refresh tokens are kept a little longer than they are valid, so
// a replayed old token is still recognised as reuse until then.
const EXPIRED_REFRESH_GRACE_DAYS = 7;

/** Idempotency records past their 24-hour window (includes crashed "pending" ones). */
export async function purgeExpiredIdempotencyRecords(now = new Date()) {
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { expires_at: { lt: now } },
  });
  return count;
}

/** DeviceRegistration where is_active = false and last_seen_at older than 90 days. */
export async function purgeStaleDeviceRegistrations(now = new Date()) {
  const { count } = await prisma.deviceRegistration.deleteMany({
    where: {
      is_active: false,
      last_seen_at: { lt: new Date(now.getTime() - STALE_DEVICE_DAYS * DAY_MS) },
    },
  });
  return count;
}

/** Refresh tokens that expired more than a week ago (revoked or not). */
export async function purgeExpiredRefreshTokens(now = new Date()) {
  const { count } = await prisma.refreshToken.deleteMany({
    where: {
      expires_at: {
        lt: new Date(now.getTime() - EXPIRED_REFRESH_GRACE_DAYS * DAY_MS),
      },
    },
  });
  return count;
}

async function runJob(name, job) {
  try {
    const removed = await job();
    console.log(`[maintenance] ${name}: removed ${removed}`);
  } catch (error) {
    console.error(`[maintenance] ${name} failed:`, error.message);
  }
}

export async function runDailyMaintenance() {
  await runJob("idempotency records", purgeExpiredIdempotencyRecords);
  await runJob("expired refresh tokens", purgeExpiredRefreshTokens);
}

export async function runWeeklyMaintenance() {
  await runJob("stale device registrations", purgeStaleDeviceRegistrations);
}

let started = false;

/** Starts the schedules. Safe to call more than once — it starts only once. */
export function startMaintenanceScheduler() {
  if (started) return;
  started = true;

  const options = { timezone: "Asia/Kolkata" };
  cron.schedule("30 3 * * *", () => void runDailyMaintenance(), options); // daily 03:30
  cron.schedule("45 3 * * 0", () => void runWeeklyMaintenance(), options); // Sundays 03:45
  console.log("[cron] maintenance scheduler started (03:30 daily, Sun 03:45 weekly, Asia/Kolkata)");
}
