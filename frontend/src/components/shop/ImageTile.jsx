import { useState } from "react";
import { defaultTileImage, useSiteImages } from "../../hooks/useSiteImages.js";

/**
 * A home tile with a photo behind it. The photo is the Super Admin's upload, else the built-in
 * /tiles/<slot>.jpg. Until a photo has loaded (or when there is none) the tile keeps its plain
 * colours (`plain`); with a photo the text turns white (`withImage`) over a dark gradient so it
 * stays readable on any picture.
 *
 * `children` is a function: children(hasPhoto) so a tile can drop decorations when a photo is shown.
 */
export default function ImageTile({ slot, as: Tag = "button", className = "", plain = "", withImage = "text-white", children, ...rest }) {
  const images = useSiteImages();
  const src = images[slot] || defaultTileImage(slot);
  const [loadedSrc, setLoadedSrc] = useState("");
  const hasPhoto = loadedSrc === src;
  return (
    <Tag type={Tag === "button" ? "button" : undefined} className={`relative isolate overflow-hidden ${hasPhoto ? withImage : plain} ${className}`} {...rest}>
      <img
        key={src}
        src={src}
        alt=""
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setLoadedSrc("")}
        className={`absolute inset-0 -z-10 h-full w-full object-cover transition-opacity duration-300 ${hasPhoto ? "opacity-100" : "opacity-0"}`}
      />
      {hasPhoto && <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/35 to-black/15" />}
      {children(hasPhoto)}
    </Tag>
  );
}
