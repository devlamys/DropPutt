import { inr } from "../../utils/format.js";
import { categoryOf, productEmoji } from "./visuals.js";

export const press = "transition-transform active:scale-[0.98]";

/** One shop in a list. A closed shop is shown greyed out and cannot be opened. */
export default function ShopCard({ shop, inCart, onOpen, closed = false }) {
  const cat = categoryOf(shop.shop_category);
  const menu = [...(shop.products ?? []), ...(shop.unavailable ?? [])];
  const products = shop.products ?? [];
  const preview = products.slice(0, 2).map((p) => p.name);
  const snacks = shop.shop_category === "BAKERY_COOLBAR";
  const Root = closed ? "div" : "button";
  return (
    <Root
      {...(closed ? {} : { type: "button", onClick: () => onOpen(shop.id), "aria-label": `Open ${shop.shop_name}` })}
      className={`flex min-h-12 w-full gap-3 rounded-xl border border-slate-200/80 bg-white p-3 text-left ${closed ? "" : press}`}
    >
      <span className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl text-4xl ${snacks ? "bg-amber-100" : "bg-flame-50"} ${closed ? "grayscale" : ""}`} aria-hidden="true">
        {productEmoji(menu[0]?.name ?? shop.shop_name, shop.shop_category)}
        {closed && <span className="absolute inset-0 flex items-center justify-center bg-slate-900/55 text-[11px] font-extrabold tracking-wider text-white">CLOSED</span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className={`truncate text-base font-bold ${closed ? "text-slate-500" : "text-slate-900"}`}>{shop.shop_name}</h3>
          {closed ? (
            <span className="mt-0.5 shrink-0 text-[11px] font-bold text-slate-500">Closed now</span>
          ) : (
            <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] font-bold text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Open
            </span>
          )}
        </div>
        <p className="truncate text-xs text-slate-500">
          {cat.label}
          {shop.address ? ` · ${shop.address.split(",")[0]}` : ""}
        </p>
        {closed ? (
          <p className="mt-1 text-xs text-slate-500">Not taking orders right now. Check back soon.</p>
        ) : (
          <>
            {preview.length > 0 && <p className="mt-1 truncate text-xs text-slate-600">{preview.join(" · ")}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
              <span className="rounded-lg bg-slate-100 px-2 py-1 tabular-nums text-slate-700">Min {inr(shop.min_order_value)}</span>
              <span className="rounded-lg bg-slate-100 px-2 py-1 tabular-nums text-slate-700">{products.length} item{products.length === 1 ? "" : "s"} now</span>
              {inCart && <span className="rounded-lg bg-[#E8431A] px-2 py-1 text-white">In your cart</span>}
            </div>
          </>
        )}
      </div>
    </Root>
  );
}
