import { Clock, Search, ShoppingBag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { inr } from "../utils/format.js";
import Stepper from "./shop/Stepper.jsx";
import { useStorefront } from "./shop/StorefrontContext.jsx";
import { categoryOf, productEmoji } from "./shop/visuals.js";

const SNACK_SLOT = "EVENING_SNACKS_3_TO_6";
const press = "transition-transform active:scale-[0.98]";
const isSnackCombo = (p) => p.slot_type === SNACK_SLOT || p.is_combo;

function MenuRow({ product, shop, quantity, onAdd, onRemove, unavailable }) {
  const snack = isSnackCombo(product);
  const note = unavailable
    ? unavailable.reason === "SOLD_OUT"
      ? "Sold out"
      : unavailable.available_window
        ? `Available ${unavailable.available_window}`
        : "Not available right now"
    : null;
  return (
    <li className={`flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm ${unavailable ? "opacity-70" : ""}`}>
      <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-4xl ${snack ? "bg-amber-100" : "bg-emerald-50"} ${unavailable ? "grayscale" : ""}`} aria-hidden="true">
        {productEmoji(product.name, shop.shop_category)}
      </span>
      <div className="min-w-0 flex-1">
        {snack && <span className="mb-0.5 inline-block rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-900">{product.is_combo ? "Combo" : "4 PM"}</span>}
        <p className="font-bold leading-snug text-slate-900">{product.name}</p>
        <p className="font-bold tabular-nums text-slate-900">{inr(product.price)}</p>
        {note && (
          <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-slate-500">
            <Clock className="h-3 w-3" /> {note}
          </p>
        )}
      </div>
      {!unavailable && <Stepper quantity={quantity} label={product.name} onAdd={onAdd} onRemove={onRemove} compact />}
    </li>
  );
}

/**
 * Bottom drawer with one shop's whole menu. Opened by tapping a hotel or
 * bakery card. Filter: all items, or only the 4 PM snack combos.
 */
export default function VendorMenuDrawer({ shopId, onClose, onViewCart }) {
  const { shopById, feed, quantityOf, addProduct, removeOne, cart, totals, loading } = useStorefront();
  const shop = shopById.get(shopId);
  const [filter, setFilter] = useState("all"); // "all" | "snacks"
  const [query, setQuery] = useState("");

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const match = (p) => !q || p.name.toLowerCase().includes(q);
  const view = useMemo(() => {
    if (!shop) return { now: [], later: [], snackCount: 0 };
    const keep = (p) => match(p) && (filter === "all" || isSnackCombo(p));
    return {
      now: shop.products.filter(keep),
      later: (shop.unavailable ?? []).filter(keep),
      snackCount: [...shop.products, ...(shop.unavailable ?? [])].filter(isSnackCombo).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop, filter, q]);

  const cat = shop ? categoryOf(shop.shop_category) : null;
  const inThisCart = shop && cart.vendor_id === shop.id && totals.count > 0;
  const short = shop ? Number(shop.min_order_value) - totals.subtotal : 0;
  const snackWindow = Boolean(feed?.is_chayakadi_window);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 motion-safe:animate-fade-in" role="dialog" aria-modal="true" aria-label={shop ? `${shop.shop_name} menu` : "Shop menu"} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[94vh] min-h-[60vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl motion-safe:animate-sheet-up">
        {/* header */}
        <header className="bg-white px-5 pb-3 pt-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {shop ? (
                <>
                  <h2 className="truncate text-xl font-extrabold text-slate-900">{shop.shop_name}</h2>
                  <p className="truncate text-xs text-slate-500">
                    {cat.label}
                    {shop.address ? ` · ${shop.address.split(",").slice(0, 2).join(",")}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Open now</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 tabular-nums text-slate-700">Min {inr(shop.min_order_value)}</span>
                  </div>
                </>
              ) : loading ? (
                <div className="space-y-2" aria-busy="true" aria-label="Loading menu">
                  <div className="h-6 w-44 animate-pulse rounded-lg bg-slate-200" />
                  <div className="h-4 w-32 animate-pulse rounded-lg bg-slate-200" />
                </div>
              ) : (
                <h2 className="text-lg font-extrabold">This shop is closed right now</h2>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Close menu" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 ${press}`}>
              <X className="h-5 w-5" />
            </button>
          </div>

          {shop && (
            <>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Menu filter">
                <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")} className={`h-12 shrink-0 rounded-full border-2 px-5 text-sm font-bold ${press} ${filter === "all" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                  All items
                </button>
                <button type="button" aria-pressed={filter === "snacks"} onClick={() => setFilter("snacks")} className={`flex h-12 shrink-0 items-center gap-2 rounded-full border-2 px-5 text-sm font-bold ${press} ${filter === "snacks" ? "border-amber-500 bg-amber-400 text-slate-900" : "border-slate-200 bg-white text-slate-700"}`}>
                  <span aria-hidden="true">☕</span> 4 PM Snack Combos
                  {view.snackCount > 0 && <span className="rounded-full bg-black/10 px-1.5 text-xs tabular-nums">{view.snackCount}</span>}
                </button>
              </div>
              <label className="mt-2 flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 focus-within:border-emerald-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-100">
                <Search className="h-5 w-5 shrink-0 text-slate-400" />
                <span className="sr-only">Search this menu</span>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search in ${shop.shop_name}`} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden" />
              </label>
            </>
          )}
        </header>

        {/* menu */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!shop && !loading && (
            <div className="py-12 text-center">
              <p className="text-5xl" aria-hidden="true">🌙</p>
              <p className="mt-3 text-sm text-slate-500">It isn't taking orders at the moment. Other shops are open.</p>
              <button type="button" onClick={onClose} className={`mt-5 h-12 rounded-2xl bg-emerald-600 px-6 text-sm font-bold text-white ${press}`}>Browse other shops</button>
            </div>
          )}

          {shop && filter === "snacks" && (
            <p className={`rounded-2xl px-4 py-3 text-xs font-semibold ${snackWindow ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-slate-100 text-slate-600"}`}>
              {snackWindow ? "☕ 4 PM ചായക്കടി & കൂൾബാർ സമയം · live until 6 PM." : "☕ Snack combos are served 3 PM – 6 PM. You can see them here, and order when the window opens."}
            </p>
          )}

          {shop && view.now.length > 0 && (
            <section aria-label="Available now">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Available now · <span className="tabular-nums">{view.now.length}</span></h3>
              <ul className="space-y-2.5">
                {view.now.map((p) => (
                  <MenuRow key={p.id} product={p} shop={shop} quantity={quantityOf(p.id)} onAdd={() => addProduct(p, shop.shop_name)} onRemove={() => removeOne(p.id)} />
                ))}
              </ul>
            </section>
          )}
          {shop && view.later.length > 0 && (
            <section aria-label="Not available right now">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Not available right now · <span className="tabular-nums">{view.later.length}</span></h3>
              <ul className="space-y-2.5">
                {view.later.map((p) => <MenuRow key={p.id} product={p} shop={shop} unavailable={p} />)}
              </ul>
            </section>
          )}
          {shop && view.now.length === 0 && view.later.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-5xl" aria-hidden="true">{filter === "snacks" ? "☕" : "🍽️"}</p>
              <p className="mt-3 font-bold text-slate-900">{q ? `Nothing matches "${query.trim()}"` : filter === "snacks" ? "No 4 PM snack combos here" : "Nothing on the menu yet"}</p>
              {filter === "snacks" && <button type="button" onClick={() => setFilter("all")} className={`mt-4 h-12 rounded-2xl bg-slate-100 px-6 text-sm font-bold text-slate-700 ${press}`}>See all items</button>}
            </div>
          )}
        </div>

        {/* cart summary for this shop */}
        {inThisCart && (
          <div className="bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
            {short > 0 && (
              <p className="mb-2 text-center text-xs font-semibold text-amber-800">Add <span className="tabular-nums">{inr(short)}</span> more to reach the minimum order</p>
            )}
            <button type="button" onClick={onViewCart} className={`flex h-14 w-full items-center gap-3 rounded-2xl bg-emerald-600 px-4 text-left text-white shadow-lg shadow-emerald-900/25 hover:bg-emerald-700 ${press}`}>
              <ShoppingBag className="h-5 w-5 shrink-0" />
              <span className="flex-1 text-sm font-extrabold tabular-nums">{totals.count} item{totals.count === 1 ? "" : "s"} · {inr(totals.subtotal)}</span>
              <span className="text-sm font-extrabold">View cart ›</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
