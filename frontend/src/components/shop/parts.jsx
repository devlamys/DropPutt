import { Minus, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { inr } from "../../utils/format.js";
import { categoryOf, productEmoji, tableFor } from "./visuals.js";

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

/** Orange "Add" pill that turns into a − n + stepper. */
export function AddButton({ quantity, onAdd, onRemove, label, size = "md" }) {
  const box = size === "sm" ? "h-8 min-w-[76px] text-xs" : "h-9 min-w-[92px] text-sm";
  if (!quantity) {
    return (
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${label}`}
        className={`${box} rounded-full bg-flame-600 px-3 font-semibold text-white shadow-sm transition hover:bg-flame-700 active:scale-95`}
      >
        Add to cart
      </button>
    );
  }
  return (
    <div className={`${box} flex items-center justify-between rounded-full bg-flame-600 font-bold text-white shadow-sm motion-safe:animate-pop`}>
      <button type="button" onClick={onRemove} aria-label={`Remove one ${label}`} className="flex h-full w-8 items-center justify-center rounded-l-full hover:bg-flame-700">
        <Minus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
      <span aria-live="polite">{quantity}</span>
      <button type="button" onClick={onAdd} aria-label={`Add one more ${label}`} className="flex h-full w-8 items-center justify-center rounded-r-full hover:bg-flame-700">
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
    </div>
  );
}

/** Item card: picture on top, dark green footer with name, price and Add. */
export function ProductTile({ product, shop, quantity, onAdd, onRemove, showShop = true }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-pine-800 shadow-md">
      <ProductImage product={product} shopCategory={shop?.shop_category} className="aspect-[4/3] w-full" />
      <div className="flex flex-1 flex-col gap-2 p-3 text-white">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {product.name}
            {product.is_combo && <span className="ml-1.5 rounded bg-flame-500/25 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-flame-200">Combo</span>}
          </p>
          {showShop && shop && <p className="mt-0.5 truncate text-[11px] text-pine-200">{shop.shop_name}</p>}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <AddButton size="sm" quantity={quantity} onAdd={onAdd} onRemove={onRemove} label={product.name} />
          <span className="text-sm font-semibold tabular-nums">{inr(product.price)}</span>
        </div>
      </div>
    </div>
  );
}

/** Menu row: text on the left, picture with the Add button on the right. */
export function ProductRow({ product, shop, quantity, onAdd, onRemove, unavailable }) {
  const note = unavailable
    ? unavailable.reason === "SOLD_OUT"
      ? "Sold out"
      : unavailable.available_window
        ? `Available ${unavailable.available_window}`
        : "Not available right now"
    : null;
  return (
    <li className="flex items-start justify-between gap-4 py-4">
      <div className={`min-w-0 flex-1 ${unavailable ? "opacity-60" : ""}`}>
        {product.is_combo && <span className="mb-1 inline-block rounded bg-flame-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-flame-800">Combo</span>}
        <p className="font-medium leading-snug text-pine-950">{product.name}</p>
        <p className="mt-0.5 font-semibold text-pine-900">{inr(product.price)}</p>
        {note && <p className="mt-1 text-xs font-medium text-slate-500">{note}</p>}
      </div>
      <div className="relative shrink-0 pb-4">
        <ProductImage product={product} shopCategory={shop?.shop_category} dimmed={Boolean(unavailable)} className="h-24 w-28 rounded-2xl" />
        {!unavailable && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center">
            <AddButton size="sm" quantity={quantity} onAdd={onAdd} onRemove={onRemove} label={product.name} />
          </div>
        )}
      </div>
    </li>
  );
}

/** Shop card: cover picture, dark green footer, "View menu". */
export function ShopCard({ shop, inCart }) {
  const cat = categoryOf(shop.shop_category);
  // Cover art uses the whole menu, so a shop looks the same all day.
  const menu = [...shop.products, ...(shop.unavailable ?? [])];
  const cover = menu[0] ?? { name: shop.shop_name };
  const total = shop.products.length;
  return (
    <Link to={`/shop/${shop.id}`} className="group flex flex-col overflow-hidden rounded-2xl bg-pine-800 shadow-md transition hover:shadow-xl active:scale-[0.99]">
      <div className="relative">
        <ProductImage product={cover} shopCategory={shop.shop_category} className="aspect-[16/9] w-full" />
        {inCart && <span className="absolute left-3 top-3 rounded-full bg-flame-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow">In your cart</span>}
        <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-pine-800 shadow">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Open
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4 text-white">
        <h3 className="text-lg font-medium leading-tight">{shop.shop_name}</h3>
        <p className="mt-0.5 truncate text-sm text-pine-200">
          {cat.label}
          {shop.address ? ` · ${shop.address.split(",")[0]}` : ""}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-pine-100">
            Min order {inr(shop.min_order_value)} · {total} item{total === 1 ? "" : "s"} now
          </p>
          <span className="shrink-0 rounded-full bg-flame-600 px-3 py-1.5 text-xs font-semibold text-white transition group-hover:bg-flame-700">View menu</span>
        </div>
      </div>
    </Link>
  );
}

const shimmer = "bg-[linear-gradient(90deg,#E7E7E2_25%,#D9D9D2_37%,#E7E7E2_63%)] bg-[length:400%_100%] motion-safe:animate-shimmer";
export function Skeleton({ className = "" }) {
  return <div className={`rounded-2xl ${shimmer} ${className}`} />;
}

export function HomeSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10" aria-busy="true" aria-label="Loading shops">
      <Skeleton className="mx-auto h-8 w-56" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44" />)}
      </div>
      <Skeleton className="mx-auto h-8 w-64" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56" />)}
      </div>
    </div>
  );
}
