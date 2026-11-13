// Every 5 minutes: re-dispatch and auto-cancel orders nobody accepted.
// Asia/Kolkata like every other schedule; the run-once lock keeps replicas from
// repeating it (jobLock.js).

import cron from "node-cron";
import { sweepStaleOrders } from "../services/staleOrderService.js";
import { runOnce } from "./jobLock.js";

let started = false;

async function sweep() {
  const result = await sweepStaleOrders();
  if (result.cancelled || result.redispatched || result.failed) {
    console.log(
      `[stale-orders] cancelled ${result.cancelled}, re-dispatched ${result.redispatched}, failed ${result.failed}`
    );
  }
}

/** Starts the schedule. Safe to call more than once — it starts only once. */
export function startStaleOrderScheduler() {
  if (started) return;
  started = true;
  cron.schedule("*/5 * * * *", () => void runOnce("stale-orders", sweep), { timezone: "Asia/Kolkata" });
  console.log("[cron] stale-order sweep started (every 5 min, Asia/Kolkata)");
}
