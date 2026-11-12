// FCM push (SPEC §51). Push is best-effort: when Firebase is not configured
// every send is a logged no-op, and failures never break the request.

import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

const BATCH_SIZE = 500;
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

let messaging; // undefined = not tried yet, null = disabled

function getMessagingClient() {
  if (messaging !== undefined) return messaging;
  try {
    const file = env.firebaseServiceAccountPath;
    if (!file || !fs.existsSync(file)) {
      console.warn("[push] Firebase service account not configured — push disabled.");
      messaging = null;
      return messaging;
    }
    if (getApps().length === 0) {
      initializeApp({ credential: cert(JSON.parse(fs.readFileSync(file, "utf8"))) });
    }
    messaging = getMessaging();
  } catch (error) {
    console.error("[push] Firebase init failed — push disabled:", error.message);
    messaging = null;
  }
  return messaging;
}

async function deactivateTokens(tokens) {
  if (tokens.length === 0) return;
  await prisma.deviceRegistration.updateMany({
    where: { fcm_token: { in: tokens } },
    data: { is_active: false },
  });
  await prisma.user.updateMany({
    where: { fcm_token: { in: tokens } },
    data: { fcm_token: null },
  });
  await prisma.customer.updateMany({
    where: { fcm_token: { in: tokens } },
    data: { fcm_token: null },
  });
  console.log(`[push] deactivated ${tokens.length} dead token(s)`);
}

/**
 * Sends one notification to many tokens in batches of ≤ 500.
 * `data` values are coerced to strings; it should include `deep_link`.
 */
export async function sendToTokens(
  tokens,
  { title, body, data = {}, channel = "order_updates" }
) {
  const unique = [...new Set(tokens.filter(Boolean))];
  const client = getMessagingClient();
  if (!client || unique.length === 0) return { sent: 0, failed: 0 };

  const stringData = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, String(value)])
  );
  const highPriority = channel === "order_alerts";
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    try {
      const result = await client.sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data: stringData,
        android: {
          priority: highPriority ? "high" : "normal",
          notification: { channelId: channel, sound: "default" },
        },
        apns: {
          headers: { "apns-priority": highPriority ? "10" : "5" },
          payload: { aps: { sound: "default" } },
        },
      });
      sent += result.successCount;
      failed += result.failureCount;
      const dead = batch.filter((token, index) =>
        DEAD_TOKEN_CODES.has(result.responses[index]?.error?.code)
      );
      await deactivateTokens(dead);
    } catch (error) {
      failed += batch.length;
      console.error("[push] batch send failed:", error.message);
    }
  }
  return { sent, failed };
}

/** Pushes to every active device of the given staff / rider users. */
export async function pushToUsers(userIds, message) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0 || !getMessagingClient()) return;
  try {
    const [users, devices] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids }, is_active: true, fcm_token: { not: null } },
        select: { fcm_token: true },
      }),
      prisma.deviceRegistration.findMany({
        where: { user_id: { in: ids }, is_active: true },
        select: { fcm_token: true },
      }),
    ]);
    await sendToTokens(
      [...users, ...devices].map((row) => row.fcm_token),
      message
    );
  } catch (error) {
    console.error("[push] pushToUsers failed:", error.message);
  }
}
