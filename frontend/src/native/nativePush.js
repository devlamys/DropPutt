// Push for the Android apps (Capacitor + Firebase Cloud Messaging). The plugin is loaded only
// inside the app, so web builds never carry it. The server side is the same as for the web:
// the token is registered at POST /device/register with platform "android".

import api from "../utils/api.js";

const TOKEN_KEY = "dropputt.fcm_token";
let plugin = null;
let started = false;
let state = "default"; // "default" | "granted" | "denied"

async function load() {
  plugin ??= (await import("@capacitor/push-notifications")).PushNotifications;
  return plugin;
}

const saveToken = (token) => {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private storage: the token is simply re-fetched next launch */
  }
};

/** Android groups notifications into channels; the server names the channel on every send (utils/push.js). */
async function createChannels(push) {
  try {
    await push.createChannel({ id: "order_alerts", name: "New orders", description: "Loud alerts for new orders", importance: 5, visibility: 1, vibration: true });
    await push.createChannel({ id: "order_updates", name: "Order updates", description: "Status of your orders", importance: 3, visibility: 1 });
  } catch {
    /* older Android has no channels */
  }
}

async function start(push) {
  if (started) return;
  started = true;
  await push.addListener("registration", async ({ value }) => {
    try {
      await api.post("/device/register", { fcm_token: value, platform: "android" });
      saveToken(value);
    } catch (error) {
      console.warn("[push] could not register the device:", error?.message || error);
    }
  });
  await push.addListener("registrationError", (error) => console.warn("[push] registration failed:", error));
  // Tapping a notification opens the screen the server named.
  await push.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const path = notification?.data?.web_path;
    if (typeof path === "string" && path.startsWith("/")) window.location.assign(path);
  });
}

export const nativePushState = () => state;

/** Reads the current permission (no prompt) and, when allowed, registers this device quietly. */
export async function nativeRefresh() {
  const push = await load();
  const { receive } = await push.checkPermissions();
  state = receive === "granted" ? "granted" : receive === "denied" ? "denied" : "default";
  if (state === "granted") {
    await createChannels(push);
    await start(push);
    await push.register();
  }
  return state;
}

/** Asks for permission (call from a tap), then registers. */
export async function nativeEnable() {
  const push = await load();
  const { receive } = await push.requestPermissions();
  state = receive === "granted" ? "granted" : receive === "denied" ? "denied" : "default";
  if (state === "granted") {
    await createChannels(push);
    await start(push);
    await push.register();
  }
  return state;
}
