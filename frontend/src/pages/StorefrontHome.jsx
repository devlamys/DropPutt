import LogoMark from "../components/LogoMark.jsx";
import { ChevronDown, ClipboardList, Clock, Home, Search, ShoppingBag, ShoppingBasket, Truck, Utensils, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { placeName } from "../components/shop/chrome.jsx";
import Stepper from "../components/shop/Stepper.jsx";
import { useStorefront } from "../components/shop/StorefrontContext.jsx";
import { categoryOf, productEmoji } from "../components/shop/visuals.js";
import { inr } from "../utils/format.js";

// ── 4 PM window, evaluated on the customer's clock in Asia/Kolkata ──────────
const istClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const SNACK_START = 15 * 60;
const SNACK_END = 18 * 60;

function istMinutes(now = new Date()) {
  const [h, m] = istClock.format(now).split(":").map(Number);
  return h * 60 + m;
}
const hm = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

/** { open, left } — left is minutes until the window closes (open) or opens (closed). */
function snackWindow(now) {
  const m = istMinutes(now);
  if (m >= SNACK_START && m < SNACK_END) return { open: true, left: SNACK_END - m };
  return { open: false, left: m < SNACK_START ? SNACK_START - m : 24 * 60 - m + SNACK_START };
}

// ── category pills ──────────────────────────────────────────────────────────
const SNACK_SLOT = "EVENING_SNACKS_3_TO_6";
const PILLS = [
  { key: "all", label: "All", emoji: "🍽️", match: () => true },
  { key: "hotels", label: "Hotels", emoji: "🍛", match: (v) => v.shop_category === "HOTEL" },
  {
    key: "snacks",
    label: "4 PM Snacks",
    emoji: "☕",
    amber: true,
    match: (v) => v.shop_category === "BAKERY_COOLBAR" || v.products.some((p) => p.slot_type === SNACK_SLOT),
  },
  { key: "grocery", label: "Grocery", emoji: "🛒", match: (v) => v.shop_category === "GROCERY" },
  { key: "fish", label: "Fish & Meat", emoji: "🐟", match: (v) => v.shop_category === "FISH_MEAT" },
  { key: "medical", label: "Medical Rx", emoji: "💊", match: (v) => v.shop_category === "MEDICAL_PHARMACY" },
];

const press = "transition-transform active:scale-[0.98]";

const shimmer = "bg-[linear-gradient(90deg,#E7E7E2_25%,#D9D9D2_37%,#E7E7E2_63%)] bg-[length:400%_100%] motion-safe:animate-shimmer";

function Skeleton({ className = "" }) {
  return <div className={`rounded-2xl ${shimmer} ${className}`} />;
}

function HomeSkeleton() {
  return (
    <div className="space-y-4 px-4 pt-4" aria-busy="true" aria-label="Loading shops">
      <Skeleton className="h-32" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="row-span-2 h-44" />
        <Skeleton className="h-[5.25rem]" />
        <Skeleton className="h-[5.25rem]" />
      </div>
      <div className="flex gap-2 overflow-hidden">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-28 shrink-0 !rounded-full" />)}</div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex gap-3 rounded-2xl bg-white p-3">
          <Skeleton className="h-20 w-20 shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-3/5 !rounded-md" />
            <Skeleton className="h-3 w-4/5 !rounded-md" />
            <Skeleton className="h-3 w-2/5 !rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ShopCard({ shop, inCart, onOpen, closed = false }) {
  const cat = categoryOf(shop.shop_category);
  const menu = [...shop.products, ...(shop.unavailable ?? [])];
  const preview = shop.products.slice(0, 2).map((p) => p.name);
  const snacks = shop.shop_category === "BAKERY_COOLBAR";
  const Root = closed ? "div" : "button";
  return (
    <Root
      {...(closed ? {} : { type: "button", onClick: () => onOpen(shop.id), "aria-label": `Open ${shop.shop_name} menu` })}
      className={`flex min-h-12 w-full gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 text-left shadow-sm ${closed ? "" : press}`}
    >
      <span className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-4xl ${snacks ? "bg-amber-100" : "bg-flame-50"} ${closed ? "grayscale" : ""}`} aria-hidden="true">
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
              <span className="rounded-full bg-slate-100 px-2 py-1 tabular-nums text-slate-700">Min {inr(shop.min_order_value)}</span>
              <span className="rounded-full bg-slate-100 px-2 py-1 tabular-nums text-slate-700">{shop.products.length} item{shop.products.length === 1 ? "" : "s"} now</span>
              {inCart && <span className="rounded-full bg-flame-600 px-2 py-1 text-white">In your cart</span>}
            </div>
          </>
        )}
      </div>
    </Root>
  );
}

// Shop sections on the "All" view, in this order. `pill` is the category pill that "View all" opens.
const SECTIONS = [
  { category: "HOTEL", label: "Hotels & restaurants", pill: "hotels" },
  { category: "BAKERY_COOLBAR", label: "Bakery, cool bar & snacks", pill: "snacks" },
  { category: "GROCERY", label: "Grocery", pill: "grocery" },
  { category: "FISH_MEAT", label: "Fish & meat", pill: "fish" },
  { category: "MEDICAL_PHARMACY", label: "Medical", pill: "medical" },
];
const PER_SECTION = 4;

/** Fixed bottom tab bar: the four things a customer does most. */
function BottomNav({ cartCount, orderCount, onHome, onSearch, onCart, onOrders }) {
  const tab = "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-semibold text-slate-500 transition-colors active:text-flame-600";
  const badge = (n) => n > 0 && <span className="absolute right-[28%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-flame-600 px-1 text-[10px] font-bold tabular-nums text-white">{n}</span>;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 mx-auto flex h-16 max-w-md border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <button type="button" onClick={onHome} className={`${tab} !text-flame-600`}><Home className="h-6 w-6" />Home</button>
      <button type="button" onClick={onSearch} className={tab}><Search className="h-6 w-6" />Search</button>
      <button type="button" onClick={onCart} className={tab}><ShoppingBag className="h-6 w-6" />Cart{badge(cartCount)}</button>
      <button type="button" onClick={onOrders} className={tab}><ClipboardList className="h-6 w-6" />Orders{badge(orderCount)}</button>
    </nav>
  );
}

export default function StorefrontHome() {
  const {
    feed, vendors, closedVendors, zone, loading, error, reload, cart, quantityOf, addProduct, removeOne, openZones,
    totals, minOrder, cartShop, openCart, openCustom, openOrders, openVendor, orderCount, franchiseName, toast,
  } = useStorefront();
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState("all");
  const [now, setNow] = useState(() => new Date());
  const shopsRef = useRef(null);
  const searchRef = useRef(null);
  const shownError = useRef("");

  // Tick every 30 s: banner countdown, and refresh the menu when the 4 PM window flips.
  const windowState = snackWindow(now);
  const feedSaysOpen = feed?.is_chayakadi_window;
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (feed && feedSaysOpen !== undefined && feedSaysOpen !== windowState.open) reload();
  }, [feed, feedSaysOpen, windowState.open, reload]);

  useEffect(() => {
    if (error && shownError.current !== error) {
      shownError.current = error;
      toast?.(error, "error");
    }
  }, [error, toast]);

  const town = franchiseName || placeName() || "your town";
  const snackMin = feed?.pinned?.min_order_value ?? "80";

  const active = PILLS.find((p) => p.key === pill) ?? PILLS[0];
  const shops = vendors.filter(active.match);
  const closed = closedVendors.filter(active.match);
  const sections = SECTIONS.map((sec) => ({ ...sec, shops: shops.filter((v) => v.shop_category === sec.category) })).filter((sec) => sec.shops.length > 0);
  const grouped = pill === "all" && sections.length > 1;
  const allProducts = useMemo(() => vendors.flatMap((shop) => shop.products.map((product) => ({ product, shop }))), [vendors]);
  const offers = useMemo(() => allProducts.filter(({ product }) => product.original_price), [allProducts]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    return {
      dishes: allProducts.filter(({ product }) => product.name.toLowerCase().includes(q)),
      shops: [...vendors, ...closedVendors].filter((v) => v.shop_name.toLowerCase().includes(q) || categoryOf(v.shop_category).label.toLowerCase().includes(q)),
    };
  }, [q, allProducts, vendors, closedVendors]);

  const goShops = (key) => {
    setQuery("");
    if (key) setPill(key);
    setTimeout(() => shopsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const short = minOrder - totals.subtotal;
  const progress = minOrder > 0 ? Math.min(100, Math.round((totals.subtotal / minOrder) * 100)) : 100;

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-36 text-slate-900 shadow-xl">
      {/* ── 1. Sticky header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <LogoMark size={48} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-slate-500">Delivering in • നമ്മുടെ നാട്</p>
            <h1 className="truncate text-lg font-extrabold leading-tight text-slate-900">{town}</h1>
            <button type="button" onClick={openZones} aria-label="Delivery charges" className="flex items-center gap-1 text-xs font-semibold text-flame-700">
              Delivery charges <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
            </button>
          </div>
        </div>
        <label className="mt-3 flex h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 focus-within:border-flame-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-flame-100">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <span className="sr-only">Search dishes and shops</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search biryani, shakes, shops…"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </header>

      {loading && !feed && <HomeSkeleton />}
      {error && !feed && (
        <div className="m-4 rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-sm">
          <p className="text-4xl" aria-hidden="true">📡</p>
          <p className="mt-2 font-bold">We couldn't load the shops</p>
          <p className="text-sm text-slate-500">{error}</p>
          <button type="button" onClick={reload} className={`mt-4 h-12 rounded-2xl bg-flame-600 px-6 text-sm font-bold text-white ${press}`}>Try again</button>
        </div>
      )}

      {/* ── Search results ───────────────────────────────────────────── */}
      {feed && results && (
        <main className="space-y-6 px-4 pt-4">
          {results.dishes.length === 0 && results.shops.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-5xl" aria-hidden="true">🔍</p>
              <p className="mt-3 text-lg font-bold">Nothing matches "{query.trim()}"</p>
              <p className="text-sm text-slate-500">Try another name, or ask a rider to buy it for you.</p>
              <button type="button" onClick={() => openCustom("CUSTOM_BUY")} className={`mt-5 h-12 rounded-2xl bg-amber-400 px-6 text-sm font-bold text-slate-900 ${press}`}>
                Buy Anything • എന്തും വാങ്ങാം
              </button>
            </div>
          ) : (
            <>
              {results.dishes.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Dishes · <span className="tabular-nums">{results.dishes.length}</span></h2>
                  <ul className="space-y-2">
                    {results.dishes.map(({ product, shop }) => (
                      <li key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-flame-50 text-3xl" aria-hidden="true">{productEmoji(product.name, shop.shop_category)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">{product.name}</p>
                          <p className="truncate text-xs text-slate-500">{shop.shop_name}</p>
                          <p className="font-bold tabular-nums">{inr(product.price)}</p>
                        </div>
                        <Stepper quantity={quantityOf(product.id)} label={product.name} onAdd={() => addProduct(product, shop.shop_name)} onRemove={() => removeOne(product.id)} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {results.shops.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Shops</h2>
                  <div className="space-y-3">{results.shops.map((s) => <ShopCard key={s.id} shop={s} inCart={cart.vendor_id === s.id} onOpen={openVendor} closed={s.is_open === false} />)}</div>
                </section>
              )}
            </>
          )}
        </main>
      )}

      {/* ── Home ─────────────────────────────────────────────────────── */}
      {feed && !results && (
        <main className="space-y-5 pt-4">
          {/* 2. 4 PM banner */}
          <section className="px-4" aria-label="4 PM Chayakadi">
            <button
              type="button"
              onClick={() => goShops("snacks")}
              className={`relative flex w-full items-center gap-3 overflow-hidden rounded-2xl p-4 text-left shadow-sm ${press} ${
                windowState.open ? "bg-gradient-to-br from-amber-400 to-amber-500 text-slate-900" : "border border-amber-200 bg-amber-50 text-slate-800"
              }`}
            >
              <span className="text-5xl drop-shadow-sm" aria-hidden="true">☕</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-extrabold leading-snug">4 PM ചായക്കടി &amp; കൂൾബാർ സമയം</span>
                <span className="mt-0.5 block text-sm font-semibold">4 PM Chayakadi &amp; Coolbar Combos (Min {inr(snackMin)})</span>
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold tabular-nums">
                  <Clock className="h-3.5 w-3.5" />
                  {windowState.open ? `Live now · ends in ${hm(windowState.left)}` : `Opens 3:00 PM · in ${hm(windowState.left)}`}
                </span>
              </span>
            </button>
          </section>

          {/* 3. Action bento grid */}
          <section className="grid grid-cols-2 gap-3 px-4" aria-label="What would you like to do?">
            <button type="button" onClick={() => goShops("all")} className={`relative row-span-2 flex min-h-[11rem] flex-col justify-between overflow-hidden rounded-2xl bg-flame-600 p-4 text-left text-white shadow-sm hover:bg-flame-700 ${press}`}>
              <Utensils className="h-8 w-8 text-flame-100" />
              <span>
                <span className="block text-lg font-extrabold leading-tight">Order Food &amp; Snacks</span>
                <span className="mt-1 block text-xs font-medium text-flame-100">ഭക്ഷണം ഓർഡർ ചെയ്യാം</span>
              </span>
              <span className="pointer-events-none absolute -bottom-3 -right-2 text-7xl opacity-25" aria-hidden="true">🍛</span>
            </button>

            <button type="button" onClick={() => openCustom("CUSTOM_BUY")} className={`relative flex min-h-[5.25rem] items-center gap-2 overflow-hidden rounded-2xl bg-amber-400 p-3 text-left text-slate-900 shadow-md ring-2 ring-amber-500/60 ${press}`}>
              <ShoppingBasket className="h-7 w-7 shrink-0" />
              <span className="min-w-0">
                <span className="mb-1 inline-block rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">Popular</span>
                <span className="block text-[15px] font-extrabold leading-tight">Buy Anything <span className="font-bold">(Custom Book)</span></span>
                <span className="block text-[11px] font-semibold text-slate-800">എന്തും വാങ്ങാം</span>
              </span>
            </button>

            <button type="button" onClick={() => openCustom("PICK_DROP")} className={`flex min-h-[5.25rem] items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 text-left shadow-sm ${press}`}>
              <Truck className="h-7 w-7 shrink-0 text-flame-700" />
              <span className="min-w-0">
                <span className="block text-[15px] font-extrabold leading-tight">Pick &amp; Drop / Mini Truck</span>
                <span className="block text-[11px] font-semibold text-slate-500">പിക്ക് &amp; ഡ്രോപ്പ് · മിനി ട്രക്ക്</span>
              </span>
            </button>
          </section>

          {/* 3b. Special offers (the hotels' own discounts) */}
          {offers.length > 0 && (
            <section aria-label="Special offers">
              <h2 className="mb-2 px-4 text-lg font-extrabold">Special offers</h2>
              <div className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {offers.slice(0, 12).map(({ product, shop }) => (
                  <div key={product.id} className="flex w-44 shrink-0 flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
                    <div>
                      {product.offer_label && <span className="rounded-full bg-flame-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{product.offer_label}</span>}
                      <p className="mt-2 line-clamp-2 text-sm font-bold leading-snug">{product.name}</p>
                      <p className="truncate text-xs text-slate-500">{shop.shop_name}</p>
                      <p className="mt-1 text-base font-extrabold tabular-nums">
                        {inr(product.price)} <span className="text-xs font-semibold text-slate-400 line-through">{inr(product.original_price)}</span>
                      </p>
                    </div>
                    <div className="mt-2">
                      <Stepper compact quantity={quantityOf(product.id)} label={product.name} onAdd={() => addProduct(product, shop.shop_name)} onRemove={() => removeOne(product.id)} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. Category pills */}
          <nav aria-label="Categories" className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PILLS.map((p) => {
              const on = pill === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPill(p.key)}
                  className={`flex h-12 shrink-0 items-center gap-2 rounded-full border-2 px-4 text-sm font-bold ${press} ${
                    on
                      ? p.amber
                        ? "border-amber-500 bg-amber-400 text-slate-900"
                        : "border-flame-600 bg-flame-600 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <span aria-hidden="true">{p.emoji}</span>
                  {p.label}
                </button>
              );
            })}
          </nav>

          {/* 5. Shops: open first, grouped by kind on "All"; closed ones last */}
          <div ref={shopsRef} className="scroll-mt-44 space-y-6 px-4">
            {shops.length === 0 ? (
              <section aria-label="Shops" className="rounded-2xl border border-slate-200/80 bg-white px-5 py-10 text-center shadow-sm">
                <p className="text-5xl" aria-hidden="true">{active.emoji}</p>
                <p className="mt-3 text-base font-bold">No {pill === "all" ? "" : `${active.label.toLowerCase()} `}shops open right now</p>
                <p className="mt-1 text-sm text-slate-500">Need it anyway? A rider can buy it for you from any shop in town.</p>
                <div className="mt-4 flex flex-col gap-2">
                  <button type="button" onClick={() => openCustom("CUSTOM_BUY")} className={`h-12 rounded-2xl bg-amber-400 text-sm font-bold text-slate-900 ${press}`}>Buy Anything • എന്തും വാങ്ങാം</button>
                  {pill !== "all" && <button type="button" onClick={() => setPill("all")} className={`h-12 rounded-2xl bg-slate-100 text-sm font-bold text-slate-700 ${press}`}>See all shops</button>}
                </div>
              </section>
            ) : grouped ? (
              sections.map((sec) => (
                <section key={sec.category} aria-label={sec.label}>
                  <div className="mb-3 flex items-end justify-between">
                    <h2 className="text-lg font-extrabold">{sec.label}</h2>
                    <span className="text-xs font-semibold tabular-nums text-slate-500">{sec.shops.length} open</span>
                  </div>
                  <div className="space-y-3">{sec.shops.slice(0, PER_SECTION).map((sh) => <ShopCard key={sh.id} shop={sh} inCart={cart.vendor_id === sh.id} onOpen={openVendor} />)}</div>
                  {sec.shops.length > PER_SECTION && (
                    <button type="button" onClick={() => goShops(sec.pill)} className={`mt-3 h-12 w-full rounded-2xl bg-flame-600 text-sm font-bold text-white hover:bg-flame-700 ${press}`}>
                      View all {sec.shops.length} {sec.label.toLowerCase()}
                    </button>
                  )}
                </section>
              ))
            ) : (
              <section aria-label="Shops">
                <div className="mb-3 flex items-end justify-between">
                  <h2 className="text-lg font-extrabold">{pill === "all" ? "Shops near you" : active.label}</h2>
                  <span className="text-xs font-semibold tabular-nums text-slate-500">{shops.length} open</span>
                </div>
                <div className="space-y-3">{shops.map((sh) => <ShopCard key={sh.id} shop={sh} inCart={cart.vendor_id === sh.id} onOpen={openVendor} />)}</div>
              </section>
            )}

            {closed.length > 0 && (
              <section aria-label="Closed shops">
                <h2 className="mb-3 text-base font-extrabold text-slate-500">Closed right now · <span className="tabular-nums">{closed.length}</span></h2>
                <div className="space-y-3">{closed.map((sh) => <ShopCard key={sh.id} shop={sh} closed />)}</div>
              </section>
            )}
          </div>

          <p className="px-6 pb-2 text-center text-xs text-slate-400">Cash on delivery · Prices are set by each shop and confirmed by the rider at pickup.</p>
        </main>
      )}

      {/* ── Floating cart summary bar ────────────────────────────────── */}
      {totals.count > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 mx-auto max-w-md px-3 pb-2">
          <div className="pointer-events-auto motion-safe:animate-sheet-up">
            {short > 0 && (
              <div className="mb-2 rounded-2xl bg-amber-50 px-4 pb-2.5 pt-2 text-xs font-semibold text-amber-900 shadow-md ring-1 ring-amber-200">
                Add <span className="tabular-nums">{inr(short)}</span> more to reach {cart.shop_name}'s minimum order
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-amber-200"><div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} /></div>
              </div>
            )}
            <button type="button" onClick={openCart} aria-label={`View cart, ${totals.count} item${totals.count === 1 ? "" : "s"}, ${inr(totals.subtotal)}`} className={`flex h-14 w-full items-center gap-3 rounded-2xl bg-flame-600 px-4 text-left text-white shadow-xl shadow-flame-900/25 hover:bg-flame-700 ${press}`}>
              <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
                <ShoppingBag className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold tabular-nums">{totals.count} item{totals.count === 1 ? "" : "s"} · {inr(totals.subtotal)}</span>
                <span className="block truncate text-xs text-flame-100">{cartShop?.shop_name ?? cart.shop_name}</span>
              </span>
              <span className="text-sm font-extrabold">View cart ›</span>
            </button>
          </div>
        </div>
      )}
      <BottomNav
        cartCount={totals.count}
        orderCount={orderCount}
        onHome={() => { setQuery(""); setPill("all"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        onSearch={() => { window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => searchRef.current?.focus(), 250); }}
        onCart={() => (totals.count > 0 ? openCart() : toast?.("Your cart is empty. Add something tasty first.", "info"))}
        onOrders={openOrders}
      />
    </div>
  );
}

