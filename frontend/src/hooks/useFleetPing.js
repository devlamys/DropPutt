import { useEffect } from "react";

const PING_EVERY_MS = 20_000;

/**
 * While a rider is online but not on a delivery, shares a coarse position
 * with the franchise Fleet Radar (`rider_fleet_ping`). Customers never see it.
 */
export function useFleetPing({ socket, enabled }) {
  useEffect(() => {
    if (!enabled || !socket || !("geolocation" in navigator)) return undefined;
    let latest = null;
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        latest = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 30_000 }
    );
    const send = () => {
      if (latest && socket.connected) {
        socket.emit("rider_fleet_ping", { ...latest, timestamp: Date.now() });
      }
    };
    const first = setTimeout(send, 3000);
    const timer = setInterval(send, PING_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [socket, enabled]);
}
