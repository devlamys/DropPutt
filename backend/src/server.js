// Process entry point: HTTP + Socket.io + cron.

import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { closeRedis, connectRedis, createPubSub } from "./config/redis.js";
import { createAdapter } from "@socket.io/redis-adapter";
import { startMaintenanceScheduler } from "./cron/maintenance.js";
import { startPushScheduler } from "./cron/pushScheduler.js";
import { initSocket } from "./socket/socketHandler.js";

// Fail fast with a readable message instead of failing on the first request.
if (!process.env.DATABASE_URL) {
  console.error(
    "[server] DATABASE_URL is not set. Copy .env.example to .env and set it."
  );
  process.exit(1);
}
try {
  await prisma.$connect();
} catch (error) {
  console.error(
    "[server] Cannot connect to the database. Check DATABASE_URL and that PostgreSQL is running.\n" +
      String(error.message).trim().split("\n").pop()
  );
  process.exit(1);
}

// Redis is optional (one replica needs none). In production a configured but
// unreachable Redis stops the process rather than splitting Socket.io rooms.
try {
  await connectRedis();
} catch (error) {
  console.error(`[server] ${error.message}`);
  process.exit(1);
}

const app = createApp();
const server = http.createServer(app);
const io = initSocket(server);

const pubsub = await createPubSub();
if (pubsub) {
  io.adapter(createAdapter(pubsub.pub, pubsub.sub));
  console.log("[server] Socket.io Redis adapter enabled");
}

if (env.enableCron) {
  startPushScheduler();
  startMaintenanceScheduler();
}

server.listen(env.port, () => {
  console.log(`[server] DropPutt API listening on :${env.port} (${env.NODE_ENV})`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — shutting down`);

  // Stop accepting work, then release the database pool.
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  io.close(async () => {
    await closeRedis();
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
