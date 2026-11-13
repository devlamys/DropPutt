// Socket.io live tracking (SPEC §28–§30).
//
// Rooms are always chosen by the server:
//   franchise:{id}          franchise admins
//   franchise:{id}:riders   every rider of the franchise
//   rider:{rider_id}        one rider
//   vendor:{vendor_id}      one vendor
//   order:{order_id}        assigned rider + customers holding the Magic Link
//
// Handshake auth (never the query string):
//   { token: "<access JWT>" }            staff / rider
//   { location_token: "<magic link>" }   public customer tracking

import { Server } from "socket.io";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { getRedis } from "../config/redis.js";
import { resolveUserFromToken } from "../middleware/auth.js";
import { ACTIVE_ORDER_STATUSES } from "../utils/constants.js";
import { MAX_ID } from "../utils/validate.js";

export const rooms = Object.freeze({
  franchise: (id) => `franchise:${id}`,
  franchiseRiders: (id) => `franchise:${id}:riders`,
  rider: (id) => `rider:${id}`,
  vendor: (id) => `vendor:${id}`,
  order: (id) => `order:${id}`,
});

let io = null;

export const getIO = () => io;

/** Emits to a room; a no-op when Socket.io is not running (tests, scripts). */
export function emitTo(room, event, payload) {
  if (io) io.to(room).emit(event, payload);
}

/** Puts every connected socket of a rider into an order room. */
export function joinRiderToOrder(riderId, orderId) {
  if (io) io.in(rooms.rider(riderId)).socketsJoin(rooms.order(orderId));
}

const LOCATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const ORDER_AUTH_CACHE_MS = 15 * 1000;

// Replay protection (SPEC §50.1): a timestamp already applied for an order is
// ignored. Shared through Redis when several replicas run; otherwise a
// bounded in-process set.
const SEEN_MAX_ORDERS = 500;
const SEEN_MAX_PER_ORDER = 1000;
const SEEN_TTL_SECONDS = 2 * 60 * 60; // points older than 2 h are rejected anyway
const seenTimestamps = new Map(); // order_id -> Set<timestamp>

function markSeenInMemory(orderId, timestamp) {
  let seen = seenTimestamps.get(orderId);
  if (!seen) {
    if (seenTimestamps.size >= SEEN_MAX_ORDERS) {
      seenTimestamps.delete(seenTimestamps.keys().next().value);
    }
    seen = new Set();
    seenTimestamps.set(orderId, seen);
  }
  if (seen.has(timestamp)) return false;
  if (seen.size >= SEEN_MAX_PER_ORDER) seen.delete(seen.values().next().value);
  seen.add(timestamp);
  return true;
}

/** true = first time this point is seen. */
async function markSeen(orderId, timestamp) {
  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.set(`dp:loc:${orderId}:${timestamp}`, "1", {
        NX: true,
        EX: SEEN_TTL_SECONDS,
      });
      return stored === "OK";
    } catch (error) {
      console.error("[socket] redis dedupe failed, using memory:", error.message);
    }
  }
  return markSeenInMemory(orderId, timestamp);
}

const locationSchema = z.object({
  order_id: z.number().int().positive().max(MAX_ID),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional(),
  timestamp: z.number().int().positive(),
});

/**
 * Validates and applies one rider location update, then broadcasts
 * `live_bike_position` to the order room. Shared by the socket event and
 * (later) the REST offline-flush endpoint.
 *
 * `rider` is server-derived: { id, franchise_id }.
 * Returns true if emitted, "duplicate" if that timestamp was already applied,
 * false if rejected.
 */
export async function applyRiderLocation(rider, payload, { authCache, exceptSocket } = {}) {
  const now = Date.now();
  // Reject clocks from the future; accept replayed offline events (≤ 2 h old).
  if (payload.timestamp > now + 60 * 1000 || payload.timestamp < now - 2 * 60 * 60 * 1000) {
    return false;
  }

  const cached = authCache?.get(payload.order_id);
  if (!cached || cached < now) {
    // The franchise comes from the rider row, never from the client.
    const order = await prisma.order.findFirst({
      where: {
        id: payload.order_id,
        franchise_id: rider.franchise_id,
        rider_id: rider.id,
        order_status: { in: ACTIVE_ORDER_STATUSES },
      },
      select: { id: true },
    });
    if (!order) {
      authCache?.delete(payload.order_id);
      return false;
    }
    authCache?.set(payload.order_id, now + ORDER_AUTH_CACHE_MS);
  }

  if (!(await markSeen(payload.order_id, payload.timestamp))) return "duplicate";

  const seenAt = new Date(payload.timestamp);
  // Replayed (older) points are still broadcast but never move the stored
  // "current" position backwards.
  await prisma.rider.updateMany({
    where: {
      id: rider.id,
      OR: [{ last_location_at: null }, { last_location_at: { lte: seenAt } }],
    },
    data: {
      current_lat: payload.lat.toFixed(7),
      current_lng: payload.lng.toFixed(7),
      last_location_at: seenAt,
    },
  });

  // No rider identity in the customer-facing event.
  const event = {
    order_id: payload.order_id,
    lat: payload.lat,
    lng: payload.lng,
    accuracy: payload.accuracy ?? null,
    timestamp: payload.timestamp,
  };
  const target = exceptSocket
    ? exceptSocket.to(rooms.order(payload.order_id))
    : io?.to(rooms.order(payload.order_id));
  target?.emit("live_bike_position", event);
  emitFleetMove(rider, payload);
  return true;
}

/**
 * Offline-flush variant of applyRiderLocation for one order: one ownership
 * query, one Redis round trip for replay protection and one rider update (the
 * stored position only moves forward). Points must be sorted oldest first.
 * Returns { accepted, duplicates, rejected }.
 */
export async function applyRiderLocationBatch(rider, orderId, points) {
  const result = { accepted: 0, duplicates: 0, rejected: 0 };
  const now = Date.now();
  const inWindow = points.filter(
    (p) => p.timestamp <= now + 60 * 1000 && p.timestamp >= now - 2 * 60 * 60 * 1000
  );
  result.rejected = points.length - inWindow.length;
  if (inWindow.length === 0) return result;

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      franchise_id: rider.franchise_id,
      rider_id: rider.id,
      order_status: { in: ACTIVE_ORDER_STATUSES },
    },
    select: { id: true },
  });
  if (!order) {
    result.rejected += inWindow.length;
    return result;
  }

  let fresh = null; // boolean per point: first time seen
  const redis = getRedis();
  if (redis) {
    try {
      const multi = redis.multi();
      for (const p of inWindow) {
        multi.set(`dp:loc:${orderId}:${p.timestamp}`, "1", {
          NX: true,
          EX: SEEN_TTL_SECONDS,
        });
      }
      const replies = await multi.exec();
      fresh = replies.map((reply) => reply === "OK");
    } catch (error) {
      console.error("[socket] redis batch dedupe failed, using memory:", error.message);
    }
  }
  if (!fresh) fresh = inWindow.map((p) => markSeenInMemory(orderId, p.timestamp));

  const accepted = inWindow.filter((_, i) => fresh[i]);
  result.duplicates = inWindow.length - accepted.length;
  result.accepted = accepted.length;
  if (accepted.length === 0) return result;

  const newest = accepted[accepted.length - 1];
  const seenAt = new Date(newest.timestamp);
  await prisma.rider.updateMany({
    where: {
      id: rider.id,
      OR: [{ last_location_at: null }, { last_location_at: { lte: seenAt } }],
    },
    data: {
      current_lat: newest.lat.toFixed(7),
      current_lng: newest.lng.toFixed(7),
      last_location_at: seenAt,
    },
  });

  for (const p of accepted) {
    io?.to(rooms.order(orderId)).emit("live_bike_position", {
      order_id: orderId,
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy ?? null,
      timestamp: p.timestamp,
    });
    emitFleetMove(rider, { order_id: orderId, ...p });
  }
  return result;
}

/** Franchise admins' Fleet Radar (franchise:{id} room). */
function emitFleetMove(rider, payload) {
  io?.to(rooms.franchise(rider.franchise_id)).emit("fleet_rider_move", {
    rider_id: rider.id,
    order_id: payload.order_id ?? null,
    lat: payload.lat,
    lng: payload.lng,
    accuracy: payload.accuracy ?? null,
    timestamp: payload.timestamp,
  });
}

const fleetPingSchema = locationSchema.omit({ order_id: true });
const FLEET_PING_MIN_MS = 10 * 1000;

/**
 * Position of an online rider who is not on a delivery (Fleet Radar only;
 * nothing goes to customers). Throttled per socket.
 */
async function applyFleetPing(socket, payload) {
  const { rider } = socket.data;
  const now = Date.now();
  if (socket.data.last_fleet_ping && now - socket.data.last_fleet_ping < FLEET_PING_MIN_MS) {
    return false;
  }
  if (payload.timestamp > now + 60 * 1000 || payload.timestamp < now - 5 * 60 * 1000) {
    return false;
  }
  socket.data.last_fleet_ping = now;

  const seenAt = new Date(payload.timestamp);
  const { count } = await prisma.rider.updateMany({
    where: {
      id: rider.id,
      is_online: true,
      OR: [{ last_location_at: null }, { last_location_at: { lte: seenAt } }],
    },
    data: {
      current_lat: payload.lat.toFixed(7),
      current_lng: payload.lng.toFixed(7),
      last_location_at: seenAt,
    },
  });
  if (count === 0) return false;
  emitFleetMove(rider, payload);
  return true;
}

async function authenticateSocket(socket) {
  const auth = socket.handshake.auth || {};

  if (typeof auth.token === "string" && auth.token) {
    const { user, payload } = await resolveUserFromToken(auth.token);
    socket.data.user = user;
    socket.data.token_exp_ms = payload.exp * 1000;

    if (user.role === "RIDER") {
      const rider = await prisma.rider.findFirst({
        where: { user_id: user.id, franchise_id: user.franchise_id },
        select: { id: true, franchise_id: true },
      });
      if (!rider) throw new Error("FORBIDDEN");
      socket.data.rider = rider;
      socket.data.order_auth = new Map();
    } else if (user.role === "VENDOR") {
      const vendor = await prisma.vendor.findFirst({
        where: { user_id: user.id, franchise_id: user.franchise_id },
        select: { id: true },
      });
      if (!vendor) throw new Error("FORBIDDEN");
      socket.data.vendor = vendor;
    } else if (user.role === "SUPER_ADMIN" && typeof auth.franchise_slug === "string") {
      // The Super Admin watches whichever franchise they have selected.
      const franchise = await prisma.franchise.findUnique({
        where: { slug: auth.franchise_slug.trim().toLowerCase() },
        select: { id: true },
      });
      if (franchise) socket.data.watch_franchise_id = franchise.id;
    }
    return;
  }

  if (typeof auth.location_token === "string" && LOCATION_TOKEN_PATTERN.test(auth.location_token)) {
    const order = await prisma.order.findUnique({
      where: { location_token: auth.location_token },
      select: { id: true, order_status: true },
    });
    if (!order || order.order_status === "CANCELLED") throw new Error("UNAUTHENTICATED");
    socket.data.tracking_order_id = order.id;
    return;
  }

  throw new Error("UNAUTHENTICATED");
}

async function joinInitialRooms(socket) {
  const { user, rider, vendor, tracking_order_id } = socket.data;

  if (tracking_order_id) {
    socket.join(rooms.order(tracking_order_id));
    return;
  }
  if (rider) {
    socket.join([rooms.rider(rider.id), rooms.franchiseRiders(rider.franchise_id)]);
    const active = await prisma.order.findMany({
      where: {
        franchise_id: rider.franchise_id,
        rider_id: rider.id,
        order_status: { in: ACTIVE_ORDER_STATUSES },
      },
      select: { id: true },
    });
    for (const order of active) socket.join(rooms.order(order.id));
  } else if (vendor) {
    socket.join(rooms.vendor(vendor.id));
  } else if (user?.role === "FRANCHISE_ADMIN" && user.franchise_id) {
    socket.join(rooms.franchise(user.franchise_id));
  } else if (user?.role === "SUPER_ADMIN" && socket.data.watch_franchise_id) {
    socket.join(rooms.franchise(socket.data.watch_franchise_id));
  }
}

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins.length ? env.corsOrigins : !env.isProduction },
  });

  io.use((socket, next) => {
    authenticateSocket(socket)
      .then(() => next())
      .catch((error) => {
        const code = error?.code || error?.message;
        next(new Error(["TOKEN_EXPIRED", "FORBIDDEN"].includes(code) ? code : "UNAUTHENTICATED"));
      });
  });

  io.on("connection", (socket) => {
    socket.on("rider_fleet_ping", async (raw, ack) => {
      const reply = (result) => typeof ack === "function" && ack(result);
      try {
        if (!socket.data.rider) return reply({ ok: false, code: "FORBIDDEN" });
        if (socket.data.token_exp_ms <= Date.now()) {
          reply({ ok: false, code: "TOKEN_EXPIRED" });
          socket.emit("auth_error", { code: "TOKEN_EXPIRED" });
          return socket.disconnect(true);
        }
        const parsed = fleetPingSchema.safeParse(raw);
        if (!parsed.success) return reply({ ok: false, code: "VALIDATION_ERROR" });
        reply({ ok: await applyFleetPing(socket, parsed.data) });
      } catch (error) {
        console.error("[socket] rider_fleet_ping failed:", error.message);
        reply({ ok: false, code: "INTERNAL_ERROR" });
      }
    });

    joinInitialRooms(socket).catch((error) => {
      console.error("[socket] failed to join rooms:", error.message);
      socket.disconnect(true);
    });

    socket.on("rider_location_move", async (raw, ack) => {
      const reply = (result) => typeof ack === "function" && ack(result);
      try {
        const { rider, token_exp_ms, order_auth } = socket.data;
        if (!rider) return reply({ ok: false, code: "FORBIDDEN" });

        // The access token is re-checked on every event; the client must
        // reconnect with a fresh token once it expires.
        if (token_exp_ms <= Date.now()) {
          reply({ ok: false, code: "TOKEN_EXPIRED" });
          socket.emit("auth_error", { code: "TOKEN_EXPIRED" });
          return socket.disconnect(true);
        }

        const parsed = locationSchema.safeParse(raw);
        if (!parsed.success) return reply({ ok: false, code: "VALIDATION_ERROR" });

        const emitted = await applyRiderLocation(rider, parsed.data, {
          authCache: order_auth,
          exceptSocket: socket,
        });
        reply(emitted ? { ok: true } : { ok: false, code: "ORDER_NOT_FOUND" }); // "duplicate" counts as ok
      } catch (error) {
        console.error("[socket] rider_location_move failed:", error.message);
        reply({ ok: false, code: "INTERNAL_ERROR" });
      }
    });
  });

  return io;
}
