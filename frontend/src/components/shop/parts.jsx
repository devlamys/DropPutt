import { Minus, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { inr } from "../../utils/format.js";
import { categoryOf, productEmoji, productTint } from "./visuals.js";

/** Product photo, or an emoji illustration when the shop has not added one. */
export function ProductImage({ product, shopCategory, className = "", emojiClass = "text-4xl", dimmed = false }) {
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt=""
        loading="lazy"
        className={`object-cover ${dimmed ? "opacity-50 grayscale" : ""} ${className}`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center ${productTint(product.name)} ${dimmed ? "opacity-50 grayscale" : ""} ${className}`}
    >
      <span className={emojiClass}>{productEmoji(product.name, shopCategory)}</span>
    </div>
  );
}

/** "ADD" that turns into a − n + stepper. */
export function AddButton({ quantity, onAdd, onRemove, label, size = "md" }) {
  const box = size === "sm" ? "h-8 w-[72px] text-xs" : "h-9 w-[88px] text-sm";
  if (!quantity) {
    return (
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${label}`}
        className={`${box} rounded-xl border border-emerald-600 bg-white font-extrabold tracking-wide text-emerald-700 shadow-sm transition active:scale-95`}
      >
        ADD
      </button>
    );
  }
  return (
    <div
      className={`${box} flex items-center justify-between rounded-xl bg-emerald-600 font-extrabold text-white shadow-sm motion-safe:animate-pop`}
    >
      <button type="button" onClick={onRemove} aria-label={`Remove one ${label}`} className="flex h-full w-7 items-center justify-center">
        <Minus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
      <span aria-live="polite">{quantity}</span>
      <button type="button" onClick={onAdd} aria-label={`Add one more ${label}`} className="flex h-full w-7 items-center justify-center">
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
    </div>
  );
}

/** Compact card for grids and carousels. */
export function ProductTile({ product, shop, quantity, onAdd, onRemove, showShop = true }) {
  return (
    <div className="flex h-full flex-col rounded-2xl bg-white p-2 shadow-sm ring-1 ring-black/5">
      <ProductImage product={product} shopCategory={shop?.shop_category} className="aspect-square w-full rounded-xl" emojiClass="text-5xl" />
      <div className="mt-2 flex flex-1 flex-col px-1 pb-1">
        {product.is_combo && <span className="mb-0.5 w-fit rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Combo</span>}
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">{product.name}</p>
        {showShop && shop && <p className="mt-0.5 truncate text-[11px] text-slate-500">{shop.shop_name}</p>}
        <div className="mt-auto flex items-center justify-between gap-1 pt-2">
          <span className="text-sm font-extrabold">{inr(product.price)}</span>
          <AddButton size="sm" quantity={quantity} onAdd={onAdd} onRemove={onRemove} label={product.name} />
        </div>
      </div>
    </div>
  );
}

/** Menu row: text on the left, picture with the ADD button on the right. */
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
        {product.is_combo && <span className="mb-1 inline-block rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Combo</span>}
        <p className="font-semibold leading-snug text-slate-900">{product.name}</p>
        <p className="mt-0.5 font-bold">{inr(product.price)}</p>
        {note && <p className="mt-1 text-xs font-medium text-slate-500">{note}</p>}
      </div>
      <div className="relative shrink-0 pb-4">
        <ProductImage product={product} shopCategory={shop?.shop_category} dimmed={Boolean(unavailable)} className="h-24 w-24 rounded-2xl" />
        {!unavailable && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center">
            <AddButton quantity={quantity} onAdd={onAdd} onRemove={onRemove} label={product.name} />
          </div>
        )}
      </div>
    </li>
  );
}

/** Shop card on the home page. */
export function ShopCard({ shop, inCart }) {
  const cat = categoryOf(shop.shop_category);
  // Cover art uses the whole menu, so a shop looks the same all day.
  const preview = [...shop.products, ...(shop.unavailable ?? [])].slice(0, 3);
  const total = shop.products.length;
  return (
    <Link
      to={`/shop/${shop.id}`}
      className="group block overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5 transition hover:shadow-md active:scale-[0.99]"
    >
      <div className={`relative flex h-28 items-center justify-center gap-1 bg-gradient-to-br ${cat.cover}`}>
        {(preview.length ? preview : [{ name: cat.label }]).map((p, i) => (
          <span key={p.id ?? i} className="text-5xl drop-shadow-sm transition group-hover:scale-110" style={{ transform: `rotate(${(i - 1) * 8}deg)` }} aria-hidden="true">
            {productEmoji(p.name, shop.shop_category)}
          </span>
        ))}
        {inCart && <span className="absolute right-3 top-3 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">In your cart</span>}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-extrabold leading-tight">{shop.shop_name}</h3>
          <span className="mt-1 flex shrink-0 items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Open
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-500">
          {cat.label}
          {shop.address ? ` · ${shop.address.split(",")[0]}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
          <span className="rounded-full bg-slate-100 px-2.5 py-1">Min order {inr(shop.min_order_value)}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1">
            {total} item{total === 1 ? "" : "s"} now
          </span>
        </div>
      </div>
    </Link>
  );
}

const shimmer = "bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_37%,#f1f5f9_63%)] bg-[length:400%_100%] motion-safe:animate-shimmer";
export function Skeleton({ className = "" }) {
  return <div className={`rounded-2xl ${shimmer} ${className}`} />;
}

export function HomeSkeleton() {
  return (
    <div className="space-y-6 px-4 pt-5" aria-busy="true" aria-label="Loading shops">
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 w-16 shrink-0 !rounded-full" />)}
      </div>
      <Skeleton className="h-32 w-full !rounded-3xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-48" />)}
      </div>
      <Skeleton className="h-52 w-full !rounded-3xl" />
    </div>
  );
}
