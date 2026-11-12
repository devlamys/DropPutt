// Run-once-per-fire job lock for several replicas (SPEC §27).
//
// Every replica's scheduler fires at the same wall-clock minute. The first to
// insert the row `cron:<job>:<minute>` wins and runs the job; the others hit
// the unique key and skip. Uses the existing IdempotencyRecord table, so no
// extra infrastructure or migration is needed, and the daily purge job
// removes the rows after their TTL.

import { prisma } from "../config/prisma.js";

const TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** The scheduled minute, e.g. "2026-11-13T10:30". */
export const fireSlot = (now = new Date()) => now.toISOString().slice(0, 16);

/** true when this process may run the job for this fire time. */
export async function claimJob(name, now = new Date()) {
  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: `cron:${name}:${fireSlot(now)}`,
        response: { cron: true },
        created_at: now,
        expires_at: new Date(now.getTime() + TTL_MS),
      },
    });
    return true;
  } catch (error) {
    if (error?.code === "P2002") return false; // another replica has it
    throw error;
  }
}

/** Runs `job` only if this replica wins the claim. Never throws. */
export async function runOnce(name, job, now = new Date()) {
  try {
    if (!(await claimJob(name, now))) {
      console.log(`[cron] ${name}: already running on another replica — skipped`);
      return false;
    }
    await job();
    return true;
  } catch (error) {
    console.error(`[cron] ${name} failed:`, error.message);
    return false;
  }
}
