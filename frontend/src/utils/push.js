// Web push (FCM) for the PWA — SPEC §62. Everything here is best-effort: when
// Firebase is not configured, or the browser cannot do push, it quietly does
// nothing and the in-app socket alerts keep working.
//
// `enablePush()` asks for permission, so call it from a tap. After permission
// is granted, `refreshPush()` can run silently on every launch.

import { isNative } from "../native/platform.js";
import { nativeEnable, nativePushState, nativeRefresh } from "../native/nativePush.js";
import api from "./api.js";

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const VAPID_KEY = env.VITE_FIREBASE_VAPID_KEY;
const TOKEN_KEY = "dropputt.fcm_token";

// The Android apps get Firebase from google-services.json, not from the web keys below.
export const pushConfigured = isNative() || Boolean(
  firebaseConfig.apiKey && firebaseConfig.messagingSenderId && firebaseConfig.appId && VAPID_KEY
);

export const pushSupported = () =>
  isNative() ||
  (typeof window !== "undefined" &&
  "Notification" in window &&
  "serviceWorker" in navigator &&
  "PushManager" in window);

/** "unsupported" | "unconfigured" | "denied" | "default" | "granted" */
export function pushState() {
  if (!pushSupported()) return "unsupported";
  if (!pushConfigured) return "unconfigured";
  if (isNative()) return nativePushState(); // updated by refreshPush / enablePush
  return Notification.permission;
}

function readToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function saveToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private window: the token is simply re-fetched next time */
  }
}

async function registerWorker() {
  const query = new URLSearchParams(
    Object.entries(firebaseConfig).filter(([, value]) => value)
  ).toString();
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${query}`, { scope: "/" });
}

async function fetchAndRegisterToken() {
  const [{ initializeApp, getApps }, { getMessaging, getToken }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  const registration = await registerWorker();
  await navigator.serviceWorker.ready;
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return null;
  await api.post("/device/register", { fcm_token: token, platform: "web" });
  saveToken(token);
  return token;
}

/** Asks permission (needs a tap) and registers this device. Returns pushState(). */
export async function enablePush() {
  if (isNative()) {
    try {
      await nativeEnable();
    } catch (error) {
      console.warn("[push] could not enable push:", error?.message || error);
    }
    return pushState();
  }
  const state = pushState();
  if (state === "unsupported" || state === "unconfigured" || state === "denied") return state;
  try {
    if (Notification.permission === "default") {
      const answer = await Notification.requestPermission();
      if (answer !== "granted") return answer;
    }
    await fetchAndRegisterToken();
  } catch (error) {
    console.warn("[push] could not enable push:", error?.message || error);
  }
  return pushState();
}

/** Silent re-registration on app launch (the token can change). No prompt. */
export async function refreshPush() {
  if (isNative()) {
    try {
      await nativeRefresh();
    } catch (error) {
      console.warn("[push] refresh failed:", error?.message || error);
    }
    return;
  }
  if (pushState() !== "granted") return;
  try {
    await fetchAndRegisterToken();
  } catch (error) {
    console.warn("[push] refresh failed:", error?.message || error);
  }
}

/** Sign-out: stop this phone getting the account's alerts. Call while still signed in. */
export async function disablePush() {
  const token = readToken();
  if (!token) return;
  try {
    await api.post("/device/unregister", { fcm_token: token });
  } catch {
    /* the next account to register this token takes it over anyway */
  }
  saveToken(null);
}
