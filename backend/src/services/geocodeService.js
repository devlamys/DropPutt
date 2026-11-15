// Place search for the map picker ("Kizhissery", "Edavanna bus stand").
// The browser never talks to the geocoder: it asks our API, which keeps the
// CSP closed, caches answers, and paces requests the way public Nominatim's
// usage policy asks (about one a second, no type-ahead). Point GEOCODER_URL at
// your own Nominatim/Photon for heavier use.

const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map(); // "query|near" -> { at, results }
let lastCall = 0;

const baseUrl = () => (process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");

export function clearGeocodeCache() {
  cache.clear();
  lastCall = 0;
}

async function pace() {
  const wait = lastCall + 1100 - Date.now();
  lastCall = Math.max(Date.now(), lastCall) + (wait > 0 ? wait : 0);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 3000)));
}

/** @returns [{ name, lat, lng }] (empty on any failure) */
export async function searchPlaces(query, near) {
  const q = String(query || "").trim().slice(0, 120);
  if (q.length < 3) return [];
  const key = `${q.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.results;

  const url = new URL(`${baseUrl()}/search`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("countrycodes", "in");
  url.searchParams.set("limit", "6");
  if (near) {
    // Prefer results near the shop (about 0.5 degree each way), without excluding others.
    url.searchParams.set("viewbox", `${near.lng - 0.5},${near.lat + 0.5},${near.lng + 0.5},${near.lat - 0.5}`);
  }
  try {
    await pace();
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "DropPutt/1.0 (local delivery app place search)", accept: "application/json" },
    });
    if (!res.ok) return [];
    const rows = await res.json();
    const results = (Array.isArray(rows) ? rows : [])
      .map((r) => ({ name: String(r.display_name ?? r.name ?? "").slice(0, 140), lat: Number(r.lat), lng: Number(r.lon) }))
      .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng));
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), results });
    return results;
  } catch {
    return [];
  }
}
