// 4 PM Chayakadi campaign push (SPEC §27, §51). All cron times are
// Asia/Kolkata.
//
// With several API replicas, run the scheduler on exactly one of them
// (ENABLE_CRON=false on the others) so campaigns are not sent twice.

import cron from "node-cron";
import { prisma } from "../config/prisma.js";
import { sendToTokens } from "../utils/push.js";

const CRON_TIME = "0 16 * * *";

let started = false;

export async function runCampaigns(cronTime = CRON_TIME) {
  const campaigns = await prisma.pushCampaign.findMany({
    where: { is_active: true, cron_time: cronTime, franchise: { is_active: true } },
    include: { franchise: { select: { id: true, slug: true } } },
  });

  for (const campaign of campaigns) {
    try {
      // Legacy single token on Customer, plus every active device.
      const [customers, devices] = await Promise.all([
        prisma.customer.findMany({
          where: { franchise_id: campaign.franchise_id, fcm_token: { not: null } },
          select: { fcm_token: true },
        }),
        prisma.deviceRegistration.findMany({
          where: {
            is_active: true,
            customer: { franchise_id: campaign.franchise_id },
          },
          select: { fcm_token: true },
        }),
      ]);
      const tokens = [...customers, ...devices].map((row) => row.fcm_token);
      if (tokens.length === 0) continue;

      const snackSlot = campaign.target_slot === "EVENING_SNACKS_3_TO_6";
      const result = await sendToTokens(tokens, {
        title: campaign.title,
        body: campaign.body,
        data: {
          type: "CAMPAIGN",
          target_slot: campaign.target_slot,
          franchise_slug: campaign.franchise.slug,
          deep_link: snackSlot
            ? `dropputt://marketplace?slot=${campaign.target_slot}`
            : `dropputt://marketplace?franchise=${campaign.franchise.slug}`,
        },
        channel: "promotions",
      });
      console.log(
        `[cron] campaign ${campaign.id} (${campaign.franchise.slug}): sent ${result.sent}, failed ${result.failed}`
      );
    } catch (error) {
      // One franchise failing must not stop the others.
      console.error(`[cron] campaign ${campaign.id} failed:`, error.message);
    }
  }
}

/** Starts the scheduler. Safe to call more than once — it starts only once. */
export function startPushScheduler() {
  if (started) return;
  started = true;

  cron.schedule(
    CRON_TIME,
    () => {
      runCampaigns().catch((error) =>
        console.error("[cron] push scheduler run failed:", error.message)
      );
    },
    { timezone: "Asia/Kolkata" }
  );
  console.log("[cron] push scheduler started (16:00 Asia/Kolkata)");
}
