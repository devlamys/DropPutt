// Axios client for the DropPutt API (SPEC §4).
//
// - Franchise slug comes from the hostname (kizhissery.techkerala.in ->
//   "kizhissery") and is sent as `x-franchise-slug` on every request.
//   localhost / IP hosts fall back to the default franchise.
// - The JWT access token is attached automatically; an expired token is
//   refreshed once (rotating refresh token) and the request is retried.

import axios from "axios";

const DEFAULT_SLUG = (import.meta.env.VITE_DEFAULT_FRANCHISE_SLUG || "kizhissery")
  .trim()
  .toLowerCase();
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || "").replace(/\/+$/, "");
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;
export const SOCKET_URL = API_ORIGIN || undefined; // same origin in dev (proxied)

const STORAGE_KEY = "dropputt.session";
const ACTING_KEY = "dropputt.acting_slug";
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Slug for a hostname, or null when the host carries no tenant. */
export function slugFromHostname(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host || host === "localhost" || IPV4.test(host) || host.includes(":")) {
    return null; // localhost, IPv4, IPv6
  }
  const labels = host.split(".");
  // "kizhissery.localhost" works for local multi-tenant testing; a bare
  // domain such as "techkerala.in" has no subdomain.
  const hasSubdomain =
    labels[labels.length - 1] === "localhost" ? labels.length >= 2 : labels.length >= 3;
  if (!hasSubdomain) return null;
  const slug = labels[0];
  if (slug === "www" || !SLUG_PATTERN.test(slug)) return null;
  return slug;
}

/** The franchise this browser tab belongs to. */
export function getHostSlug() {
  return slugFromHostname(window.location.hostname) || DEFAULT_SLUG;
}

// ---- session storage (wrapped: private windows can throw) ----------------

function readJSON(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the session just lasts until reload */
  }
}

let memorySession = readJSON(STORAGE_KEY);

export const getSession = () => memorySession;

export function saveSession(session) {
  memorySession = session;
  writeJSON(STORAGE_KEY, session);
}

export function clearSession() {
  memorySession = null;
  writeJSON(STORAGE_KEY, null);
  writeJSON(ACTING_KEY, null);
}

export const getAccessToken = () => memorySession?.access_token ?? null;

/**
 * Slug sent with requests. A Super Admin has no franchise of their own, so
 * they may act inside one by choosing it (setActingSlug); everyone else is
 * pinned to the host's franchise.
 */
export function getRequestSlug() {
  if (memorySession?.user?.role === "SUPER_ADMIN") {
    const acting = readJSON(ACTING_KEY);
    if (acting && SLUG_PATTERN.test(acting)) return acting;
  }
  return getHostSlug();
}

export const setActingSlug = (slug) => writeJSON(ACTING_KEY, slug || null);

// ---- axios instance -------------------------------------------------------

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  config.headers.set("x-franchise-slug", getRequestSlug());
  const token = getAccessToken();
  if (token && !config.skipAuth) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

// One refresh at a time; concurrent callers wait for the same result.
let refreshing = null;

async function refreshSession() {
  const session = getSession();
  if (!session?.refresh_token) throw new Error("no refresh token");
  const { data } = await axios.post(
    `${API_BASE_URL}/auth/refresh`,
    { refresh_token: session.refresh_token },
    { headers: { "x-franchise-slug": getRequestSlug() }, timeout: 20_000 }
  );
  saveSession(data.data);
  return data.data.access_token;
}

// Listeners (AuthContext) are told when the session can no longer be used.
const expiredListeners = new Set();
export const onSessionExpired = (fn) => {
  expiredListeners.add(fn);
  return () => expiredListeners.delete(fn);
};

/** Refreshes the token (once, shared). Signs out when that fails. */
async function refreshOnce() {
  refreshing ||= refreshSession().finally(() => {
    refreshing = null;
  });
  try {
    return await refreshing;
  } catch (error) {
    clearSession();
    expiredListeners.forEach((fn) => fn());
    throw error;
  }
}

function tokenMsLeft(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 - Date.now();
  } catch {
    return 0;
  }
}

/** A token with at least a minute left, refreshing if needed (used by sockets). */
export async function ensureFreshToken() {
  const token = getAccessToken();
  if (!token) return null;
  if (tokenMsLeft(token) > 60_000) return token;
  try {
    return await refreshOnce();
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const isAuthCall = config?.url?.startsWith("/auth/");
    if (response?.status === 401 && config && !config._retried && !isAuthCall && getSession()) {
      config._retried = true;
      try {
        const token = await refreshOnce();
        config.headers.set("Authorization", `Bearer ${token}`);
        return api(config);
      } catch {
        /* session cleared by refreshOnce */
      }
    }
    return Promise.reject(error);
  }
);

/** Multipart request config (axios must not JSON-encode a FormData body). */
export const MULTIPART = { headers: { "Content-Type": "multipart/form-data" }, timeout: 60_000 };

/** Idempotency-Key header for a money-changing action. */
export const idempotencyHeaders = () => ({ "Idempotency-Key": crypto.randomUUID() });

/** Readable message from an API error envelope or a network failure. */
export function getErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  const apiError = error?.response?.data?.error;
  if (apiError?.message) return apiError.message;
  if (error?.code === "ECONNABORTED") return "The request timed out. Please try again.";
  if (error?.request && !error?.response) {
    return "Cannot reach the server. Check your connection.";
  }
  return fallback;
}

// ---- auth calls -----------------------------------------------------------

/** POST /auth/login. `franchiseSlug` overrides the host slug (e.g. "admin"). */
export async function login({ phone, pin, franchiseSlug }) {
  const body = { phone, pin };
  if (franchiseSlug) body.franchise_slug = franchiseSlug;
  const { data } = await api.post("/auth/login", body, { skipAuth: true });
  return data.data;
}

export async function logout() {
  try {
    await api.post("/auth/logout");
  } catch {
    /* already invalid: local sign-out still proceeds */
  }
}

export default api;
