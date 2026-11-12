import { ChevronDown, ChevronRight, MapPin, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HomeSkeleton, ProductTile, ShopCard } from "../components/shop/parts.jsx";
import { readLastOrder, useStorefront } from "../components/shop/StorefrontContext.jsx";
import { categoryOf } from "../components/shop/visuals.js";
import { getRequestSlug } from "../utils/api.js";
import { inr } from "../utils/format.js";

const placeName = () => {
  const slug = getRequestSlug() || "";
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ") : "";
};

function Banner({ tone, emoji, title, text, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`relative flex w-[82%] shrink-0 snap-start items-center gap-3 overflow-hidden rounded-3xl p-4 text-left sm:w-80 ${tone}`}
    >
      <span className="text-5xl drop-shadow-sm" aria-hidden="true">{emoji}</span>
      <span className="min-w-0">
        <span className="block text-base font-extrabold leading-tight">{title}</span>
        <span className="mt-0.5 block text-sm opacity-90">{text}</span>
      </span>
    </Tag>
  );
}

function SectionTitle({ children, hint }) {
  return (
    <div className="mb-3 flex items-end justify-between px-4">
      <h2 className="text-xl font-extrabold tracking-tight">{children}</h2>
      {hint && <span className="text-xs font-medium text-slate-500">{hint}</span>}
    </div>
  );
}

export default function ShopHome() {
  const { feed, vendors, zones, zone, loading, error, reload, cart, quantityOf, addProduct, removeOne, openZones } = useStorefront();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const snacksRef = useRef(null);
  const lastOrder = useMemo(readLastOrder, []);
  const place = placeName();

  const categories = (feed?.categories || []).filter((c) => c.shop_category);
  const shops = vendors.filter((v) => !category || v.shop_category === category);
  const cheapest = zones.length ? Math.min(...zones.map((z) => Number(z.delivery_fee))) : null;

  // Everything orderable right now, each with its shop.
  const allProducts = useMemo(
    () => vendors.flatMap((shop) => shop.products.map((product) => ({ product, shop }))),
    [vendors]
  );
  const picks = (category ? allProducts.filter((x) => x.shop.shop_category === category) : allProducts).slice(0, 12);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    return {
      products: allProducts.filter(({ product }) => product.name.toLowerCase().includes(q)),
      shops: vendors.filter((v) => v.shop_name.toLowerCase().includes(q) || categoryOf(v.shop_category).label.toLowerCase().includes(q)),
    };
  }, [q, allProducts, vendors]);

  const tile = ({ product, shop }) => (
    <ProductTile
      product={product}
      shop={shop}
      quantity={quantityOf(product.id)}
      onAdd={() => addProduct(product, shop.shop_name)}
      onRemove={() => removeOne(product.id)}
    />
  );

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="rounded-b-[2rem] bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 px-4 pb-6 pt-4 text-white shadow-lg shadow-orange-900/10">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={openZones} className="flex min-w-0 items-center gap-2 rounded-2xl bg-white/15 py-2 pl-2.5 pr-3 text-left backdrop-blur transition hover:bg-white/25">
            <MapPin className="h-5 w-5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-orange-100">Delivering to</span>
              <span className="flex items-center gap-1 text-sm font-extrabold">
                <span className="truncate">{zone ? zone.zone_name.split("—").pop().trim() : "Choose your area"}</span>
                <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={3} />
              </span>
            </span>
          </button>
          <span className="shrink-0 text-right">
            <span className="block text-lg font-black leading-none tracking-tight">DropPutt</span>
            {place && <span className="text-[11px] font-semibold text-orange-100">{place}</span>}
          </span>
        </div>
        <h1 className="mt-5 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
          Hungry? We'll bring it <span className="whitespace-nowrap">to your door.</span>
        </h1>
      </header>

      {/* ── Sticky search ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-[#FFF9F2]/95 px-4 py-3 backdrop-blur">
        <label className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-orange-400">
          <Search className="h-5 w-5 shrink-0 text-orange-600" />
          <span className="sr-only">Search dishes and shops</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for biryani, shakes, shops…"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="rounded-full bg-slate-100 p-1 text-slate-500">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      {error && (
        <div className="mx-4 rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-4xl" aria-hidden="true">📡</p>
          <p className="mt-2 font-bold">We couldn't load the shops</p>
          <p className="text-sm text-slate-500">{error}</p>
          <button type="button" onClick={reload} className="mt-4 rounded-2xl bg-orange-600 px-6 py-2.5 font-bold text-white">
            Try again
          </button>
        </div>
      )}
      {loading && !feed && <HomeSkeleton />}

      {/* ── Search results ─────────────────────────────────────────────── */}
      {feed && results && (
        <div className="space-y-6 pt-2">
          {results.products.length === 0 && results.shops.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <p className="text-5xl" aria-hidden="true">🔍</p>
              <p className="mt-3 text-lg font-bold">Nothing matches "{query.trim()}"</p>
              <p className="text-sm text-slate-500">Try another dish or shop name.</p>
            </div>
          ) : (
            <>
              {results.products.length > 0 && (
                <section>
                  <SectionTitle hint={`${results.products.length} found`}>Dishes</SectionTitle>
                  <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {results.products.map((x) => <div key={x.product.id}>{tile(x)}</div>)}
                  </div>
                </section>
              )}
              {results.shops.length > 0 && (
                <section>
                  <SectionTitle>Shops</SectionTitle>
                  <div className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3">
                    {results.shops.map((shop) => <ShopCard key={shop.id} shop={shop} inCart={cart.vendor_id === shop.id} />)}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Home ───────────────────────────────────────────────────────── */}
      {feed && !results && (
        <div className="space-y-7 pt-1">
          {lastOrder && (
            <Link to={`/drop/${lastOrder.token}`} className="mx-4 flex items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-md">
              <span className="text-2xl" aria-hidden="true">🛵</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold">Track your order</span>
                <span className="block truncate text-xs text-slate-300">{lastOrder.number} · {lastOrder.shop}</span>
              </span>
              <ChevronRight className="h-5 w-5" />
            </Link>
          )}

          {/* categories */}
          <nav aria-label="Categories" className="flex gap-3 overflow-x-auto px-4 pb-1 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[{ key: "all", label: "All", shop_category: "", emoji: "🍽️" }, ...categories.map((c) => ({ ...c, emoji: categoryOf(c.shop_category).emoji, label: categoryOf(c.shop_category).label }))].map((c) => {
              const active = category === c.shop_category;
              return (
                <button key={c.key} type="button" onClick={() => setCategory(c.shop_category)} aria-pressed={active} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
                  <span className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl transition ${active ? "bg-orange-100 ring-[3px] ring-orange-500" : "bg-white shadow-sm ring-1 ring-black/5"}`}>
                    <span aria-hidden="true">{c.emoji}</span>
                  </span>
                  <span className={`text-center text-[11px] leading-tight ${active ? "font-extrabold text-orange-700" : "font-semibold text-slate-600"}`}>{c.label}</span>
                </button>
              );
            })}
          </nav>

          {/* banners */}
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {feed.pinned && feed.pinned.products.length > 0 ? (
              <Banner
                tone="bg-gradient-to-br from-amber-300 to-orange-300 text-orange-950"
                emoji="☕"
                title="4 PM Chayakadi is on!"
                text={`Snack combos till 6 PM · from ${inr(feed.pinned.min_order_value)}`}
                onClick={() => snacksRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            ) : (
              <Banner tone="bg-gradient-to-br from-amber-200 to-orange-200 text-orange-950" emoji="☕" title="4 PM Chayakadi" text="Tea-time snack combos, every day 3 – 6 PM" />
            )}
            {cheapest != null && (
              <Banner tone="bg-gradient-to-br from-emerald-500 to-teal-500 text-white" emoji="🛵" title={`Delivery from ${inr(cheapest)}`} text="Pay cash when it arrives. No app, no account." />
            )}
            <Banner tone="bg-gradient-to-br from-sky-500 to-indigo-500 text-white" emoji="📍" title="Hard-to-find house?" text="Share your location and a voice route after ordering." />
          </div>

          {/* 4 PM specials */}
          {feed.pinned && feed.pinned.products.length > 0 && !category && (
            <section ref={snacksRef} className="scroll-mt-20">
              <div className="mx-4 rounded-3xl bg-gradient-to-br from-amber-100 to-orange-100 p-4 ring-1 ring-orange-200">
                <h2 className="text-lg font-extrabold text-orange-950">{feed.pinned.label}</h2>
                <p className="mb-3 text-xs font-medium text-orange-900">Minimum order {inr(feed.pinned.min_order_value)} · until 6 PM</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {feed.pinned.products.map((p) => {
                    const shop = vendors.find((v) => v.id === p.vendor_id) ?? { shop_name: p.shop_name, shop_category: "BAKERY_COOLBAR" };
                    return <div key={p.id}>{tile({ product: p, shop })}</div>;
                  })}
                </div>
              </div>
            </section>
          )}

          {/* quick picks */}
          {picks.length > 0 && (
            <section>
              <SectionTitle hint="Available now">Quick picks</SectionTitle>
              <div className="flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-6 lg:overflow-visible">
                {picks.map((x) => (
                  <div key={x.product.id} className="w-40 shrink-0 lg:w-auto">{tile(x)}</div>
                ))}
              </div>
            </section>
          )}

          {/* shops */}
          <section>
            <SectionTitle hint={shops.length ? `${shops.length} open` : undefined}>
              {category ? categoryOf(category).label : "Shops near you"}
            </SectionTitle>
            {shops.length === 0 ? (
              <div className="mx-4 rounded-3xl bg-white px-6 py-12 text-center shadow-sm ring-1 ring-black/5">
                <p className="text-5xl" aria-hidden="true">{category ? categoryOf(category).emoji : "🏪"}</p>
                <p className="mt-3 text-lg font-bold">{category ? `No ${categoryOf(category).label.toLowerCase()} shops open right now` : "No shops are open right now"}</p>
                <p className="text-sm text-slate-500">Please check back a little later.</p>
                {category && (
                  <button type="button" onClick={() => setCategory("")} className="mt-4 rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white">
                    See all shops
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3">
                {shops.map((shop) => <ShopCard key={shop.id} shop={shop} inCart={cart.vendor_id === shop.id} />)}
              </div>
            )}
          </section>

          <p className="px-4 pb-2 text-center text-xs text-slate-400">Prices are set by each shop. The rider confirms the final bill at pickup.</p>
        </div>
      )}
    </div>
  );
}
