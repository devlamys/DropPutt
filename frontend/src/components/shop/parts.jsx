import { productEmoji, tableFor } from "./visuals.js";

/** An emoji served on a plate over a table surface. Fills its (sized) parent. */
export function PlateArt({ name, emoji, className = "", dimmed = false }) {
  return (
    <div aria-hidden="true" className={`plate-art relative flex items-center justify-center overflow-hidden ${tableFor(name)} ${dimmed ? "opacity-60 grayscale" : ""} ${className}`}>
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.14),transparent_60%)]" />
      <span className="relative flex aspect-square h-[80%] items-center justify-center rounded-full bg-[radial-gradient(circle,#ffffff_58%,#ECE8DF_59%,#ffffff_72%)] shadow-[0_6px_18px_rgba(0,0,0,0.35)]">
        <span className="plate-emoji">{emoji}</span>
      </span>
    </div>
  );
}

/** Product photo, or a plated illustration when the shop has not added one. */
export function ProductImage({ product, shopCategory, className = "", dimmed = false }) {
  if (product.image_url) {
    return <img src={product.image_url} alt="" loading="lazy" className={`object-cover ${dimmed ? "opacity-60 grayscale" : ""} ${className}`} />;
  }
  return <PlateArt name={product.name} emoji={productEmoji(product.name, shopCategory)} dimmed={dimmed} className={className} />;
}
