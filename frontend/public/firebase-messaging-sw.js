/* Push service worker (SPEC §62). Shows order alerts while the app is closed or
 * in the background and opens the right screen when one is tapped.
 *
 * Firebase's web config arrives in this file's URL query string
 * (see src/utils/push.js), because a service worker cannot read Vite's env. */

// Registered first, so it runs before Firebase's own click handler.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.stopImmediatePropagation();
  const payload = event.notification.data || {};
  const data = (payload.FCM_MSG && payload.FCM_MSG.data) || payload;
  event.waitUntil(openApp(pathFor(data)));
});

function pathFor(data) {
  if (data.web_path) return data.web_path;
  const link = String(data.deep_link || "");
  if (link.includes("vendor")) return "/vendor";
  if (link.includes("earnings")) return "/rider/earnings";
  return "/rider";
}

async function openApp(path) {
  const target = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin === self.location.origin && "focus" in client) {
      await client.focus();
      if ("navigate" in client && client.url !== target) {
        try { await client.navigate(target); } catch (_) { /* focus is enough */ }
      }
      return;
    }
  }
  await self.clients.openWindow(target);
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const params = new URL(self.location.href).searchParams;
const config = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  storageBucket: params.get("storageBucket"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

if (config.apiKey && config.messagingSenderId && config.appId) {
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
  self.firebase.initializeApp(config);
  // Constructing the client is enough: for messages that carry a `notification`
  // block the SDK displays them itself whenever no app window is focused.
  self.firebase.messaging();
}
