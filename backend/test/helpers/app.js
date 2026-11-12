import "./env.js";
import http from "node:http";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";
import { initSocket } from "../../src/socket/socketHandler.js";

export { prisma };

/** Starts the real app (HTTP + Socket.io) on a random port. */
export async function startServer() {
  const server = http.createServer(createApp());
  const io = initSocket(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => io.close(resolve));
      await prisma.$disconnect();
    },
  };
}

/**
 * Minimal API client: returns { status, body, headers }.
 *   api(base)(method, path, { token, slug, body, form, headers })
 */
export function client(base, defaults = {}) {
  return async (method, path, { token, slug = defaults.slug, body, form, headers = {} } = {}) => {
    const h = { ...headers };
    if (slug) h["x-franchise-slug"] = slug;
    if (token) h.authorization = `Bearer ${token}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      h["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + "/api/v1" + path, { method, headers: h, body: payload });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: json, headers: res.headers };
  };
}
