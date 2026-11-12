// Process entry point: HTTP + Socket.io + cron.

import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { startPushScheduler } from "./cron/pushScheduler.js";
import { initSocket } from "./socket/socketHandler.js";

const app = createApp();
const server = http.createServer(app);
const io = initSocket(server);

if (env.enableCron) startPushScheduler();

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
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
