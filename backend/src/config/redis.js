// Optional Redis (SPEC §43): needed only when several API replicas run, so
// Socket.io events reach clients connected to another replica and GPS replay
// protection is shared. Without REDIS_URL everything stays in-process.

import { createClient } from "redis";
import { env } from "./env.js";

let main = null; // general-purpose client (null = Redis not in use)
let extra = []; // duplicated pub/sub clients, closed with `main`

function newClient(label) {
  const client = createClient({
    url: env.redisUrl,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
  });
  // Without a listener node-redis would throw on connection errors.
  client.on("error", (error) => console.error(`[redis:${label}] ${error.message}`));
  return client;
}

/**
 * Connects when REDIS_URL is set. Returns the client, or null when Redis is
 * not configured or (outside production) not reachable.
 * In production a configured-but-unreachable Redis is fatal: running
 * replicas without it would silently split Socket.io rooms.
 */
export async function connectRedis() {
  if (!env.redisUrl) return null;
  if (main) return main;
  const client = newClient("main");
  // Production waits longer; in development a missing Redis should not slow every restart.
  const timeoutMs = env.isProduction ? 5000 : 1500;
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("connection timed out")), timeoutMs)),
    ]);
  } catch (error) {
    await client.disconnect().catch(() => {});
    if (env.isProduction) throw new Error(`Redis is configured but unreachable: ${error.message}`);
    console.warn(`[redis] ${error.message} — continuing without Redis (single instance only).`);
    return null;
  }
  main = client;
  console.log("[redis] connected");
  return main;
}

/** The connected general client, or null. */
export const getRedis = () => (main?.isReady ? main : null);

/** A pub/sub pair for the Socket.io adapter. */
export async function createPubSub() {
  if (!main) return null;
  const pub = main.duplicate();
  const sub = main.duplicate();
  for (const [label, client] of [["pub", pub], ["sub", sub]]) {
    client.on("error", (error) => console.error(`[redis:${label}] ${error.message}`));
    await client.connect();
  }
  extra = [pub, sub];
  return { pub, sub };
}

export async function closeRedis() {
  await Promise.all([main, ...extra].filter(Boolean).map((c) => c.quit().catch(() => {})));
  main = null;
  extra = [];
}
