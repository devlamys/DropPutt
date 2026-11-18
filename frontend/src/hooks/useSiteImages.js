import { useEffect, useState } from "react";
import api from "../utils/api.js";

let cached = null; // the Super Admin's tile photos, fetched once per page load
let pending = null;

function load() {
  pending ??= api
    .get("/public/site-images", { skipAuth: true })
    .then(({ data }) => (cached = data.data.images ?? {}))
    .catch(() => (cached = {}))
    .finally(() => (pending = null));
  return pending;
}

/** { slot: url } of the photos set in Super Admin → Home images ({} until loaded or when none). */
export function useSiteImages() {
  const [images, setImages] = useState(cached ?? {});
  useEffect(() => {
    let live = true;
    if (cached) setImages(cached);
    else load().then((next) => live && setImages(next));
    return () => {
      live = false;
    };
  }, []);
  return images;
}

/** Forget the cache so the next screen reads the new photos (used after an upload). */
export const forgetSiteImages = () => {
  cached = null;
};

/** The built-in photo for a tile (a file in /public/tiles), used until the Super Admin sets one. */
export const defaultTileImage = (slot) => `/tiles/${slot}.jpg`;
