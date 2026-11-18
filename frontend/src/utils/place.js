import api from "./api.js";

/** The area name for a map point ("Chullikode"), or "" when it cannot be found. */
export async function fetchPlaceName(lat, lng) {
  try {
    const { data } = await api.get("/public/reverse-geocode", { skipAuth: true, params: { lat, lng } });
    return data.data.name || "";
  } catch {
    return "";
  }
}
