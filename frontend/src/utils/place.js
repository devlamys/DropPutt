import api, { getRequestSlug } from "./api.js";

/** The area name for a map point ("Chullikode"), or "" when it cannot be found. */
export async function fetchPlaceName(lat, lng) {
  try {
    const { data } = await api.get("/public/reverse-geocode", { skipAuth: true, params: { lat, lng } });
    return data.data.name || "";
  } catch {
    return "";
  }
}

/** "Kizhissery" from the franchise slug in the address. */
export function placeName() {
  const slug = getRequestSlug() || "";
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ") : "";
}
