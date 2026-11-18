import LogoMark from "../components/LogoMark.jsx";
import { ClipboardList, Clock, CupSoda, Home, MapPin, Search, ShoppingBag, ShoppingBasket, Truck, Utensils, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import DishGrid from "../components/shop/DishGrid.jsx";
import ImageTile from "../components/shop/ImageTile.jsx";
import ShopCard from "../components/shop/ShopCard.jsx";
import { useDebounced } from "../hooks/useDebounced.js";
import { useProducts } from "../hooks/useProducts.js";
import { placeName } from "../components/shop/chrome.jsx";
import Stepper from "../components/shop/Stepper.jsx";
import { useStorefront } from "../components/shop/StorefrontContext.jsx";
import { categoryOf } from "../components/shop/visuals.js";
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

// Keeps white text readable on any photo.
const TEXT_SHADOW = "[text-shadow:0_1px_6px_rgba(0,0,0,0.6)]";

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
    totals, minOrder, cartShop, openCart, openCustom, openOrders, openVendor, orderCount, franchiseName, place, toast,
  } = useStorefront();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const navigate = useNavigate();
  const text = query.trim();
  const settled = useDebounced(text, 300);
  const showSearch = text.length >= 2 && settled.length >= 2;
  const list = useProducts({ group: "FOOD", category: showSearch ? "" : category, q: showSearch ? settled : "" });
  const goDishes = (key) => {
    setQuery("");
    if (key !== undefined) setCategory(key);
    setTimeout(() => shopsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
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

  const town = place || franchiseName || placeName() || "your town";
  const snackMin = feed?.pinned?.min_order_value ?? "80";

  const allProducts = useMemo(() => vendors.flatMap((shop) => shop.products.map((product) => ({ product, shop }))), [vendors]);
  const offers = useMemo(() => allProducts.filter(({ product }) => product.original_price), [allProducts]);

  const shopHits = useMemo(() => {
    const needle = text.toLowerCase();
    if (!needle) return [];
    return [...vendors, ...closedVendors].filter((v) => v.shop_name.toLowerCase().includes(needle) || categoryOf(v.shop_category).label.toLowerCase().includes(needle));
  }, [text, vendors, closedVendors]);

  const short = minOrder - totals.subtotal;
  const progress = minOrder > 0 ? Math.min(100, Math.round((totals.subtotal / minOrder) * 100)) : 100;

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-36 text-slate-900 shadow-xl">
      {/* ── 1. Sticky header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 px-4 pb-2 pt-2 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <LogoMark size={28} className="shrink-0" />
          <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold leading-none text-slate-900">{town}</h1>
          <button type="button" onClick={openZones} aria-label="Set delivery location and see charges" className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-flame-50 px-3 text-xs font-bold text-flame-700 ring-1 ring-flame-200">
            <MapPin className="h-3.5 w-3.5" /> Set delivery location
          </button>
        </div>
        <label className="mt-1.5 flex h-9 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 focus-within:border-flame-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-flame-100">
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

      {/* ── Search results: dishes come from the server, so every dish in town can be found ── */}
      {feed && showSearch && (
        <main className="space-y-6 px-4 pt-4">
          <section aria-label="Dishes">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Dishes</h2>
            <DishGrid
              list={list}
              empty={
                <div className="rounded-2xl bg-white px-5 py-10 text-center shadow-sm ring-1 ring-slate-200/70">
                  <p className="text-5xl" aria-hidden="true">🔍</p>
                  <p className="mt-3 text-lg font-bold">No dish matches "{text}"</p>
                  <p className="text-sm text-slate-500">Try another name, or ask a rider to buy it for you.</p>
                  <button type="button" onClick={() => openCustom("CUSTOM_BUY")} className={`mt-5 h-12 rounded-2xl bg-amber-400 px-6 text-sm font-bold text-slate-900 ${press}`}>
                    Buy Anything • എന്തും വാങ്ങാം
                  </button>
                </div>
              }
            />
          </section>
          {shopHits.length > 0 && (
            <section aria-label="Shops">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Shops</h2>
              <div className="space-y-3">{shopHits.map((s) => <ShopCard key={s.id} shop={s} inCart={cart.vendor_id === s.id} onOpen={(id) => navigate(`/shop/restaurant/${id}`)} closed={s.is_open === false} />)}</div>
            </section>
          )}
          <button type="button" onClick={() => navigate(`/shop/mart?q=${encodeURIComponent(text)}`)} className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white ${press}`}>
            <ShoppingBasket className="h-5 w-5" /> Also search the Mart for "{text}"
          </button>
        </main>
      )}

      {/* ── Home ─────────────────────────────────────────────────────── */}
      {feed && !showSearch && (
        <main className="space-y-5 pt-4">
          {/* 2. 4 PM banner */}
          <section className="px-4" aria-label="4 PM Chayakadi">
            <ImageTile
              slot="chayakadi"
              onClick={() => goDishes("EVENING_SNACKS")}
              className={`flex w-full rounded-2xl text-left shadow-sm ${press}`}
              plain={`items-center gap-3 p-4 ${windowState.open ? "bg-gradient-to-br from-amber-400 to-amber-500 text-slate-900" : "border border-amber-200 bg-amber-50 text-slate-800"}`}
              withImage="min-h-[7rem] items-end p-3 text-white"
            >
              {(photo) => (
                <>
                  {!photo && (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/85 text-amber-700 shadow-sm" aria-hidden="true">
                      <CupSoda className="h-6 w-6" />
                    </span>
                  )}
                  <span className={`min-w-0 flex-1 ${photo ? TEXT_SHADOW : ""}`}>
                    <span className={`block font-extrabold leading-snug ${photo ? "text-[13px]" : "text-[15px]"}`}>4 PM ചായക്കടി &amp; കൂൾബാർ സമയം</span>
                    <span className={`block font-semibold ${photo ? "text-[11px] opacity-95" : "mt-0.5 text-sm"}`}>4 PM Chayakadi &amp; Coolbar Combos (Min {inr(snackMin)})</span>
                    <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-900 [text-shadow:none]">
                      <Clock className="h-3 w-3" />
                      {windowState.open ? `Live now · ends in ${hm(windowState.left)}` : `Opens 3:00 PM · in ${hm(windowState.left)}`}
                    </span>
                  </span>
                </>
              )}
            </ImageTile>
          </section>

          {/* 3. Action bento grid */}
          <section className="grid grid-cols-2 gap-3 px-4" aria-label="What would you like to do?">
            <ImageTile slot="restaurants" onClick={() => navigate("/shop/restaurants")} className={`row-span-2 flex min-h-[11rem] flex-col rounded-2xl text-left shadow-sm ${press}`} plain="justify-between bg-flame-600 p-4 text-white hover:bg-flame-700" withImage="justify-end p-3 text-white">
              {(photo) => (
                <>
                  {!photo && <Utensils className="h-8 w-8 text-flame-100" />}
                  <span className={photo ? TEXT_SHADOW : ""}>
                    <span className={`block font-extrabold leading-tight ${photo ? "text-[15px]" : "text-lg"}`}>Open Restaurants</span>
                    <span className={`block font-medium ${photo ? "text-[11px] opacity-95" : "mt-1 text-xs text-flame-100"}`}>തുറന്ന ഹോട്ടലുകൾ</span>
                  </span>
                  {!photo && <span className="pointer-events-none absolute -bottom-3 -right-2 text-7xl opacity-25" aria-hidden="true">🍛</span>}
                </>
              )}
            </ImageTile>

            <ImageTile slot="buy_anything" onClick={() => openCustom("CUSTOM_BUY")} className={`flex min-h-[5.25rem] rounded-2xl text-left shadow-md ring-2 ring-amber-500/60 ${press}`} plain="items-center gap-2 bg-amber-400 p-3 text-slate-900" withImage="items-end p-3 text-white">
              {(photo) => (
                <>
                  {!photo && <ShoppingBasket className="h-7 w-7 shrink-0" />}
                  <span className={`min-w-0 ${photo ? TEXT_SHADOW : ""}`}>
                    <span className={photo ? "absolute right-2 top-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-900 [text-shadow:none]" : "mb-1 inline-block rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300"}>Popular</span>
                    <span className={`block font-extrabold leading-tight ${photo ? "text-[13px]" : "text-[15px]"}`}>Buy Anything <span className="font-bold">(Custom Book)</span></span>
                    <span className={`block font-semibold ${photo ? "text-[10px] opacity-95" : "text-[11px]"}`}>എന്തും വാങ്ങാം</span>
                  </span>
                </>
              )}
            </ImageTile>

            <ImageTile slot="pick_drop" onClick={() => openCustom("PICK_DROP")} className={`flex min-h-[5.25rem] rounded-2xl text-left shadow-sm ${press}`} plain="items-center gap-2 border border-slate-200/80 bg-white p-3 text-slate-900" withImage="items-end p-3 text-white">
              {(photo) => (
                <>
                  {!photo && <Truck className="h-7 w-7 shrink-0 text-flame-700" />}
                  <span className={`min-w-0 ${photo ? TEXT_SHADOW : ""}`}>
                    <span className={`block font-extrabold leading-tight ${photo ? "text-[13px]" : "text-[15px]"}`}>Pick &amp; Drop / Mini Truck</span>
                    <span className={`block font-semibold ${photo ? "text-[10px] opacity-95" : "text-[11px] text-slate-500"}`}>പിക്ക് &amp; ഡ്രോപ്പ് · മിനി ട്രക്ക്</span>
                  </span>
                </>
              )}
            </ImageTile>

            <ImageTile slot="mart" onClick={() => navigate("/shop/mart")} className={`col-span-2 flex rounded-2xl text-left shadow-sm ${press}`} plain="items-center gap-3 bg-gradient-to-r from-emerald-600 to-emerald-500 p-4 text-white" withImage="min-h-[4.5rem] items-end p-3 text-white">
              {(photo) => (
                <>
                  {!photo && <ShoppingBasket className="h-8 w-8 shrink-0" />}
                  <span className={`min-w-0 ${photo ? TEXT_SHADOW : ""}`}>
                    <span className={`block font-extrabold leading-tight ${photo ? "text-[15px]" : "text-lg"}`}>DropPutt Mart</span>
                    <span className={`block font-medium ${photo ? "text-[11px] opacity-95" : "text-xs text-emerald-50"}`}>Grocery · Fish &amp; Meat · Medicines · മാർട്ട്</span>
                  </span>
                  {!photo && <span className="pointer-events-none absolute -bottom-3 -right-1 text-6xl opacity-25" aria-hidden="true">🛒</span>}
                </>
              )}
            </ImageTile>
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

          {/* 4. Food tabs: every tab lists dishes */}
          <nav aria-label="Food categories" className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[{ key: "", label: "All" }, ...list.categories].map((c) => {
              const on = category === c.key;
              const snack = c.key === "EVENING_SNACKS";
              return (
                <button
                  key={c.key || "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCategory(c.key)}
                  className={`flex h-11 shrink-0 items-center rounded-full border-2 px-4 text-sm font-bold ${press} ${
                    on ? (snack ? "border-amber-500 bg-amber-400 text-slate-900" : "border-flame-600 bg-flame-600 text-white") : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </nav>

          {/* 5. Dishes */}
          <div ref={shopsRef} className="scroll-mt-28 px-4">
            <DishGrid
              list={list}
              empty={
                <section aria-label="Dishes" className="rounded-2xl border border-slate-200/80 bg-white px-5 py-10 text-center shadow-sm">
                  <p className="text-5xl" aria-hidden="true">{category === "EVENING_SNACKS" ? "☕" : "🍽️"}</p>
                  <p className="mt-3 text-base font-bold">{category === "EVENING_SNACKS" ? "No snacks available right now" : "Nothing to order right now"}</p>
                  <p className="mt-1 text-sm text-slate-500">{category === "EVENING_SNACKS" ? "4 PM snacks come between 3 and 6 PM." : "Shops may be closed. A rider can buy it for you from any shop in town."}</p>
                  <div className="mt-4 flex flex-col gap-2">
                    <button type="button" onClick={() => openCustom("CUSTOM_BUY")} className={`h-12 rounded-2xl bg-amber-400 text-sm font-bold text-slate-900 ${press}`}>Buy Anything • എന്തും വാങ്ങാം</button>
                    {category && <button type="button" onClick={() => setCategory("")} className={`h-12 rounded-2xl bg-slate-100 text-sm font-bold text-slate-700 ${press}`}>See all dishes</button>}
                  </div>
                </section>
              }
            />
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
        onHome={() => { setQuery(""); setCategory(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        onSearch={() => { window.scrollTo({ top: 0, behavior: "smooth" }); setTimeout(() => searchRef.current?.focus(), 250); }}
        onCart={() => (totals.count > 0 ? openCart() : toast?.("Your cart is empty. Add something tasty first.", "info"))}
        onOrders={openOrders}
      />
    </div>
  );
}

