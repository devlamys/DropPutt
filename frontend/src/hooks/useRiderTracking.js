import { useEffect, useRef, useState } from "react";
import api from "../utils/api.js";

const TRACKED = ["PICKED_UP", "LOCATION_SHARED"];
const EMIT_EVERY_MS = 5000; // SPEC §28
const QUEUE_MAX = 500; // ~40 min at 5 s (SPEC §50.1)
const REST_AFTER_TICKS = 3; // socket still down after ~15 s -> try REST
const ACK_TIMEOUT_MS = 5000;

/**
 * While the rider has a delivery in progress: keeps the screen awake, watches
 * GPS, and emits `rider_location_move` every 5 seconds for each such order.
 *
 * Offline (SPEC §50.1): fixes taken while the socket is down are kept in a
 * 500-point ring buffer. After reconnecting they are replayed in order over
 * the socket; if the socket stays down for ~3 ticks but the network is up,
 * they are flushed in one POST /riders/location-batch (the server ignores
 * duplicate timestamps, so retries are safe).
 * Returns { position, tracking, error, queued }.
 */
export function useRiderTracking({ socket, orders }) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState("");
  const [queued, setQueued] = useState(0);
  const queue = useRef([]); // { order_id, lat, lng, accuracy, timestamp }
  const flushing = useRef(false);
  const downTicks = useRef(0);
  const latest = useRef(null);
  const socketRef = useRef(socket);
  socketRef.current = socket;

  const orderIds = orders
    .filter((order) => TRACKED.includes(order.order_status))
    .map((order) => order.id);
  const key = orderIds.join(",");
  const idsRef = useRef(orderIds);
  idsRef.current = orderIds;

  useEffect(() => {
    if (!key) {
      latest.current = null;
      setPosition(null);
      return undefined;
    }
    if (!("geolocation" in navigator)) {
      setError("This device has no GPS.");
      return undefined;
    }

    let wakeLock = null;
    let cancelled = false;
    const requestWakeLock = async () => {
      try {
        if (!cancelled && navigator.wakeLock && document.visibilityState === "visible") {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch {
        /* not supported or denied: tracking still works while the app is open */
      }
    };
    requestWakeLock();
    const onVisible = () => {
      if (document.visibilityState === "visible") requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const fix = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
        latest.current = fix;
        setPosition(fix);
        setError("");
      },
      (err) =>
        setError(
          err.code === 1 ? "Location permission denied. Enable GPS for live tracking." : "Waiting for GPS…"
        ),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    const enqueue = (point) => {
      queue.current.push(point);
      if (queue.current.length > QUEUE_MAX) queue.current.shift();
    };

    // Replays queued points oldest-first; a point is dropped only once the
    // server acknowledged it (an ORDER_NOT_FOUND ack means the order is over).
    const flushOverSocket = async (io) => {
      while (queue.current.length && io.connected) {
        const point = queue.current[0];
        try {
          await io.timeout(ACK_TIMEOUT_MS).emitWithAck("rider_location_move", point);
        } catch {
          return false; // no ack: keep it and retry next tick
        }
        queue.current.shift();
      }
      return true;
    };

    const flushOverRest = async () => {
      const points = queue.current.slice();
      const orders = [...new Set(points.map((p) => p.order_id))];
      for (const order_id of orders) {
        const locations = points
          .filter((p) => p.order_id === order_id)
          .map(({ order_id: _o, ...rest }) => rest)
          .slice(-500);
        try {
          await api.post("/riders/location-batch", { order_id, locations });
        } catch (err) {
          // 404: the order is no longer active — nothing to deliver. Else retry later.
          if (err?.response?.status !== 404) return false;
        }
        queue.current = queue.current.filter((p) => p.order_id !== order_id || !points.includes(p));
      }
      return true;
    };

    const tick = async () => {
      const fix = latest.current;
      const io = socketRef.current;
      if (fix) {
        for (const orderId of idsRef.current) {
          const point = {
            order_id: orderId,
            lat: fix.lat,
            lng: fix.lng,
            accuracy: fix.accuracy,
            timestamp: Date.now(),
          };
          if (io?.connected && !queue.current.length) io.emit("rider_location_move", point);
          else enqueue(point);
        }
      }
      if (!flushing.current && queue.current.length) {
        flushing.current = true;
        try {
          if (io?.connected) {
            downTicks.current = 0;
            await flushOverSocket(io);
          } else {
            downTicks.current += 1;
            if (downTicks.current >= REST_AFTER_TICKS && navigator.onLine) await flushOverRest();
          }
        } finally {
          flushing.current = false;
        }
      }
      setQueued(queue.current.length);
    };
    const timer = setInterval(tick, EMIT_EVERY_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener("visibilitychange", onVisible);
      wakeLock?.release?.().catch(() => {});
    };
  }, [key]);

  return { position, tracking: Boolean(key), error, queued };
}
