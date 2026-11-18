// Location that keeps working with the screen off (Android foreground service). Used by the rider
// app only while a delivery is in progress. Outside the app it does nothing.

import { isNative } from "./platform.js";

/**
 * Starts watching. `onFix({ lat, lng, accuracy })` is called for every new position.
 * Returns a function that stops it. Rejects when the plugin cannot start (e.g. permission refused).
 */
export async function startBackgroundGps(onFix, onError) {
  if (!isNative()) throw new Error("Background location is only available in the app");
  const { registerPlugin } = await import("@capacitor/core");
  const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");
  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: "DropPutt Rider",
      backgroundMessage: "Sharing your location for the delivery in progress",
      requestPermissions: true,
      stale: false,
      distanceFilter: 5,
    },
    (location, error) => {
      if (error) {
        onError?.(error.code === "NOT_AUTHORIZED" ? "Location permission denied. Allow location 'all the time' for live tracking." : "Waiting for GPS…");
        return;
      }
      onFix({ lat: location.latitude, lng: location.longitude, accuracy: location.accuracy });
    }
  );
  return () => BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
}
