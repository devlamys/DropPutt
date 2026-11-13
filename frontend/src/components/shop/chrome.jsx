import { Bike, MapPin, Search, ShoppingBag, X } from "lucide-react";
import { Link } from "react-router-dom";
import { getRequestSlug } from "../../utils/api.js";
import { inr } from "../../utils/format.js";
import { readLastOrder, useStorefront } from "./StorefrontContext.jsx";

/** "Kizhissery" from the franchise slug in the address. */
export function placeName() {
  const slug = getRequestSlug() || "";
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ") : "";
}

export const zoneLabel = (zone) => (zone ? zone.zone_name.split("—").pop().trim() : null);

export function Logo({ className = "" }) {
  return (
    <Link to="/shop" className={`flex shrink-0 items-center gap-2 ${className}`} aria-label="DropPutt home">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-flame-600 text-white">
        <Bike className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <span className="text-xl font-semibold tracking-tight">
        <span className="text-white">Drop</span>
        <span className="text-flame-400">Putt</span>
      </span>
    </Link>
  );
}

function SearchBox({ value, onChange, placeholder, className = "" }) {
  return (
    <label className={`flex items-center gap-2 rounded-full bg-white px-4 py-2 text-pine-950 shadow-sm focus-within:ring-2 focus-within:ring-flame-400 ${className}`}>
      <Search className="h-4 w-4 shrink-0 text-pine-600" />
      <span className="sr-only">{placeholder}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="rounded-full bg-slate-100 p-0.5 text-slate-500">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  );
}

/**
 * Sticky top bar: logo, section links, search, delivery area, cart.
 * `links` is [{ label, onClick }] for the wide-screen nav.
 */
export function StoreNav({ query, onQuery, searchPlaceholder, links = [] }) {
  const { zone, openZones, totals, openCart } = useStorefront();
  const area = zoneLabel(zone);
  return (
    <header className="sticky top-0 z-30 bg-pine-900/95 text-white shadow-md backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Logo />
        {links.length > 0 && (
          <nav aria-label="Sections" className="hidden items-center gap-6 pl-4 text-sm lg:flex">
            {links.map((link, index) => (
              <button key={link.label} type="button" onClick={link.onClick} className={`transition hover:text-flame-300 ${index === 0 ? "text-flame-400" : "text-pine-100"}`}>
                {link.label}
              </button>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">
          <SearchBox value={query} onChange={onQuery} placeholder={searchPlaceholder} className="hidden w-56 md:flex lg:w-64" />
          <button
            type="button"
            onClick={openZones}
            aria-label={area ? `Delivering to ${area}. Change area` : "Choose your delivery area"}
            className="flex h-9 max-w-[9.5rem] items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-pine-900 transition hover:bg-flame-50 sm:max-w-[13rem]"
          >
            <MapPin className="h-4 w-4 shrink-0 text-flame-600" />
            <span className="truncate">{area ?? "Choose area"}</span>
          </button>
          <button
            type="button"
            onClick={openCart}
            disabled={totals.count === 0}
            aria-label={totals.count ? `Open cart, ${totals.count} items, ${inr(totals.subtotal)}` : "Cart is empty"}
            className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-pine-900 transition hover:bg-flame-50 disabled:opacity-70"
          >
            <ShoppingBag className="h-4 w-4" />
            {totals.count > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-flame-600 px-1 text-[11px] font-bold text-white">
                {totals.count}
              </span>
            )}
          </button>
        </div>
        {/* phones: search gets its own row, always reachable */}
        <SearchBox value={query} onChange={onQuery} placeholder={searchPlaceholder} className="w-full md:hidden" />
      </div>
    </header>
  );
}

/** Dark footer: what DropPutt is, how it works, delivery areas, your order. */
export function StoreFooter() {
  const { zones, zone, pickZone, totals, openCart } = useStorefront();
  const lastOrder = readLastOrder();
  const place = placeName();
  return (
    <footer className="bg-pine-950 text-pine-100">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-pine-200">
            Local hotels, bakeries and shops{place ? ` in ${place}` : ""}, delivered by riders from your own neighbourhood.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">How it works</h2>
          <ol className="mt-4 space-y-2 text-sm text-pine-200">
            <li>1. Pick a shop and add what you like.</li>
            <li>2. Place the order. No app, no account.</li>
            <li>3. Share your location or a voice route.</li>
            <li>4. Pay the rider in cash at your door.</li>
          </ol>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Delivery areas</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {zones.map((z) => (
              <li key={z.id}>
                <button
                  type="button"
                  onClick={() => pickZone(z.id)}
                  className={`flex w-full justify-between gap-3 text-left transition hover:text-flame-300 ${zone?.id === z.id ? "text-flame-400" : "text-pine-200"}`}
                >
                  <span>{zoneLabel(z)}</span>
                  <span className="shrink-0 tabular-nums">{inr(z.delivery_fee)}</span>
                </button>
              </li>
            ))}
            {zones.length === 0 && <li className="text-pine-300">Areas are being set up.</li>}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Your order</h2>
          <ul className="mt-4 space-y-2 text-sm text-pine-200">
            {lastOrder && (
              <li>
                <Link to={`/drop/${lastOrder.token}`} className="transition hover:text-flame-300">
                  Track {lastOrder.number}
                </Link>
              </li>
            )}
            <li>
              {totals.count > 0 ? (
                <button type="button" onClick={openCart} className="transition hover:text-flame-300">
                  Open cart ({totals.count})
                </button>
              ) : (
                <span>Your cart is empty</span>
              )}
            </li>
            <li>Cash on delivery</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-pine-300">
          © {new Date().getFullYear()} DropPutt{place ? ` · ${place}` : ""}. Prices are set by each shop; the rider confirms the final bill at pickup.
        </p>
      </div>
    </footer>
  );
}
