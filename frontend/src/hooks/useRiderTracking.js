import { useEffect, useRef, useState } from "react";

const TRACKED = ["PICKED_UP", "LOCATION_SHARED"];
const EMIT_EVERY_MS = 5000; // SPEC §28

/**
 * While the rider has a delivery in progress: keeps the screen awake, watches
 * GPS, and emits `rider_location_move` every 5 seconds for each such order.
 * Returns { position, tracking, error }.
 */
export function useRiderTracking({ socket, orders }) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState("");
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

    const timer = setInterval(() => {
      const fix = latest.current;
      const io = socketRef.current;
      if (!fix || !io?.connected) return;
      for (const orderId of idsRef.current) {
        io.emit("rider_location_move", {
          order_id: orderId,
          lat: fix.lat,
          lng: fix.lng,
          accuracy: fix.accuracy,
          timestamp: Date.now(),
        });
      }
    }, EMIT_EVERY_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener("visibilitychange", onVisible);
      wakeLock?.release?.().catch(() => {});
    };
  }, [key]);

  return { position, tracking: Boolean(key), error };
}
