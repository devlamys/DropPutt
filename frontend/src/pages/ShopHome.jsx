import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { StoreFooter, StoreNav, placeName, zoneLabel } from "../components/shop/chrome.jsx";
import { HomeSkeleton, PlateArt, ProductImage, ProductTile, ShopCard } from "../components/shop/parts.jsx";
import { readLastOrder, useStorefront } from "../components/shop/StorefrontContext.jsx";
import { categoryOf, productEmoji } from "../components/shop/visuals.js";
import { inr } from "../utils/format.js";

const FIRST_ITEMS = 8;

function SectionHeading({ title, text, light = false }) {
  return (
    <div className="mx-auto mb-8 max-w-xl px-4 text-center">
      <h2 className={`text-2xl font-medium tracking-tight sm:text-3xl ${light ? "text-white" : "text-pine-950"}`}>{title}</h2>
      {text && <p className={`mt-3 text-sm leading-relaxed ${light ? "text-pine-100" : "text-slate-500"}`}>{text}</p>}
    </div>
  );
}

const pill = "rounded-full px-5 py-2.5 text-sm font-semibold transition active:scale-95";

export default function ShopHome() {
  const { feed, vendors, zones, zone, loading, error, reload, cart, quantityOf, addProduct, removeOne, openZones } = useStorefront();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [showAll, setShowAll] = useState(false);
  const refs = { categories: useRef(null), menu: useRef(null), snacks: useRef(null), shops: useRef(null) };
  const lastOrder = useMemo(readLastOrder, []);
  const place = placeName();
  const go = (key) => refs[key].current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const categories = (feed?.categories || []).filter((c) => c.shop_category);
  const shops = vendors.filter((v) => !category || v.shop_category === category);
  const cheapest = zones.length ? Math.min(...zones.map((z) => Number(z.delivery_fee))) : null;
  const snacksOn = Boolean(feed?.pinned?.products?.length);

  // Everything orderable right now, each with its shop.
  const allProducts = useMemo(() => vendors.flatMap((shop) => shop.products.map((product) => ({ product, shop }))), [vendors]);
  const menu = category ? allProducts.filter((x) => x.shop.shop_category === category) : allProducts;
  const visibleMenu = showAll ? menu : menu.slice(0, FIRST_ITEMS);
  const featured = allProducts.slice(0, 3);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    return {
      products: allProducts.filter(({ product }) => product.name.toLowerCase().includes(q)),
      shops: vendors.filter((v) => v.shop_name.toLowerCase().includes(q) || categoryOf(v.shop_category).label.toLowerCase().includes(q)),
    };
  }, [q, allProducts, vendors]);

  const tile = ({ product, shop }) => (
    <ProductTile product={product} shop={shop} quantity={quantityOf(product.id)} onAdd={() => addProduct(product, shop.shop_name)} onRemove={() => removeOne(product.id)} />
  );
  const itemGrid = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4";

  const pickCategory = (value) => {
    setCategory(value);
    setShowAll(false);
  };

  const links = [
    { label: "Home", onClick: () => { setQuery(""); window.scrollTo({ top: 0, behavior: "smooth" }); } },
    { label: "Categories", onClick: () => { setQuery(""); setTimeout(() => go("categories"), 0); } },
    { label: "Menu", onClick: () => { setQuery(""); setTimeout(() => go("menu"), 0); } },
    { label: "Shops", onClick: () => { setQuery(""); setTimeout(() => go("shops"), 0); } },
  ];

  return (
    <div>
      <StoreNav query={query} onQuery={setQuery} searchPlaceholder="Search dishes and shops" links={links} />

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      {!results && (
        <section className="pine-texture relative px-4 pb-24 pt-10 text-center text-white sm:pb-32 sm:pt-16">
          <div className="mx-auto max-w-3xl">
            {place && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-flame-300">Delivering in {place}</p>}
            <h1 className="mt-3 text-[1.7rem] font-medium uppercase leading-tight tracking-tight sm:text-5xl sm:leading-[1.15]">
              Good food from local kitchens, brought to your door
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-pine-100">
              Order from hotels, bakeries and shops near you. Pay cash when it arrives — no app and no account needed.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={() => go("menu")} className={`${pill} bg-flame-600 text-white shadow-lg shadow-black/20 hover:bg-flame-700`}>
                Order food
              </button>
              <button type="button" onClick={openZones} className={`${pill} border border-flame-400 text-white hover:bg-white/10`}>
                {zone ? `Delivering to ${zoneLabel(zone)}` : "Choose your area"}
              </button>
            </div>
            {lastOrder && (
              <Link to={`/drop/${lastOrder.token}`} className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white ring-1 ring-white/20 transition hover:bg-white/20">
                🛵 Track your order {lastOrder.number} <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>

          {/* pill-shaped strip of what's cooking now */}
          <div className="absolute inset-x-0 bottom-0 translate-y-1/2 px-4">
            <div className="mx-auto grid h-28 max-w-3xl grid-cols-3 gap-1.5 sm:h-40 sm:gap-2">
              {[0, 1, 2].map((i) => {
                const item = featured[i];
                const shape = i === 0 ? "rounded-l-full" : i === 2 ? "rounded-r-full" : "";
                const frame = `h-full w-full overflow-hidden shadow-xl ring-2 ring-white ${shape}`;
                if (!item) {
                  const fallback = ["🍛", "🥟", "🥤"][i];
                  return <div key={i} className={frame}><PlateArt name={`hero-${i}`} emoji={fallback} className="h-full w-full" /></div>;
                }
                return (
                  <Link key={item.product.id} to={`/shop/${item.shop.id}`} aria-label={`${item.product.name} from ${item.shop.shop_name}`} className={`${frame} block transition hover:brightness-110`}>
                    <ProductImage product={item.product} shopCategory={item.shop.shop_category} className="h-full w-full" />
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {error && (
        <div className="mx-auto mt-24 max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
          <p className="text-4xl" aria-hidden="true">📡</p>
          <p className="mt-2 font-semibold text-pine-950">We couldn't load the shops</p>
          <p className="text-sm text-slate-500">{error}</p>
          <button type="button" onClick={reload} className={`${pill} mt-5 bg-flame-600 text-white hover:bg-flame-700`}>Try again</button>
        </div>
      )}
      {loading && !feed && <div className="pt-20"><HomeSkeleton /></div>}

      {/* ── Search results ─────────────────────────────────────────────── */}
      {feed && results && (
        <main className="mx-auto max-w-6xl px-4 py-10">
          {results.products.length === 0 && results.shops.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-5xl" aria-hidden="true">🔍</p>
              <p className="mt-3 text-lg font-medium text-pine-950">Nothing matches "{query.trim()}"</p>
              <p className="text-sm text-slate-500">Try another dish or shop name.</p>
              <button type="button" onClick={() => setQuery("")} className={`${pill} mt-5 bg-flame-600 text-white hover:bg-flame-700`}>Clear search</button>
            </div>
          ) : (
            <div className="space-y-12">
              {results.products.length > 0 && (
                <section>
                  <SectionHeading title="Dishes" text={`${results.products.length} found for "${query.trim()}"`} />
                  <div className={itemGrid}>{results.products.map((x) => <div key={x.product.id}>{tile(x)}</div>)}</div>
                </section>
              )}
              {results.shops.length > 0 && (
                <section>
                  <SectionHeading title="Shops" />
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {results.shops.map((shop) => <ShopCard key={shop.id} shop={shop} inCart={cart.vendor_id === shop.id} />)}
                  </div>
                </section>
              )}
            </div>
          )}
        </main>
      )}

      {/* ── Home sections ──────────────────────────────────────────────── */}
      {feed && !results && (
        <main>
          {/* categories */}
          <section ref={refs.categories} className="scroll-mt-28 bg-[#F3F3F0] pb-14 pt-24 sm:pt-32">
            <SectionHeading title="Order by category" text="Choose what you feel like and we'll show the shops and dishes that match." />
            <div className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6 [&::-webkit-scrollbar]:hidden">
              {[{ key: "all", shop_category: "", label: "Everything", emoji: "🍽️" }, ...categories.map((c) => ({ ...c, ...categoryOf(c.shop_category) }))].map((c) => {
                const active = category === c.shop_category;
                const open = vendors.filter((v) => !c.shop_category || v.shop_category === c.shop_category).length;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => pickCategory(c.shop_category)}
                    aria-pressed={active}
                    className="group w-36 shrink-0 text-center sm:w-auto"
                  >
                    <span className={`block overflow-hidden rounded-2xl shadow-md transition group-hover:shadow-lg ${active ? "ring-[3px] ring-flame-500 ring-offset-2 ring-offset-[#F3F3F0]" : ""}`}>
                      <PlateArt name={c.label} emoji={c.emoji} className="aspect-square w-full" />
                    </span>
                    <span className={`mt-3 block text-sm font-medium ${active ? "text-flame-700" : "text-pine-950"}`}>{c.label}</span>
                    <span className="block text-xs text-slate-500">{open ? `${open} shop${open === 1 ? "" : "s"} open` : "None open now"}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 4 PM specials, only while the window is open */}
          {snacksOn && !category && (
            <section ref={refs.snacks} className="scroll-mt-28 bg-[#FFFDF6] py-14">
              <SectionHeading title={feed.pinned.label} text={`On until 6 PM · minimum order ${inr(feed.pinned.min_order_value)}`} />
              <div className={`mx-auto max-w-6xl px-4 ${itemGrid}`}>
                {feed.pinned.products.map((p) => {
                  const shop = vendors.find((v) => v.id === p.vendor_id) ?? { shop_name: p.shop_name, shop_category: "BAKERY_COOLBAR" };
                  return <div key={p.id}>{tile({ product: p, shop })}</div>;
                })}
              </div>
            </section>
          )}

          {/* on the menu now */}
          <section ref={refs.menu} className="scroll-mt-28 bg-[#F3F3F0] pb-16 pt-4">
            <SectionHeading
              title={category ? `${categoryOf(category).label} on the menu` : "On the menu right now"}
              text="Everything here can be ordered this minute. Shops add and remove dishes through the day."
            />
            {menu.length === 0 ? (
              <p className="px-4 text-center text-sm text-slate-500">Nothing is available in this category at the moment.</p>
            ) : (
              <>
                <div className={`mx-auto max-w-6xl px-4 ${itemGrid}`}>{visibleMenu.map((x) => <div key={x.product.id}>{tile(x)}</div>)}</div>
                {menu.length > FIRST_ITEMS && (
                  <div className="mt-8 text-center">
                    <button type="button" onClick={() => setShowAll((v) => !v)} className={`${pill} bg-flame-600 text-white hover:bg-flame-700`}>
                      {showAll ? "Show fewer" : `See all ${menu.length} items`}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* shops */}
          <section ref={refs.shops} className="scroll-mt-28 bg-[#FFFDF6] py-16">
            <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 lg:grid-cols-2">
              <div>
                <h2 className="text-2xl font-medium leading-snug tracking-tight text-pine-950 sm:text-3xl">
                  {category ? `${categoryOf(category).label} shops near you` : "Every shop here cooks and packs with care."}
                </h2>
                <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-500">
                  These are shops from your own town, not a far-away warehouse. Open a shop to see its full menu, including what comes back later today.
                </p>
                <ul className="mt-5 space-y-3 text-sm text-pine-900">
                  {[
                    "Pay in cash when your order arrives",
                    cheapest != null ? `Delivery from ${inr(cheapest)}, shown before you order` : "Delivery fee shown before you order",
                    "Share your location or record a voice route for the rider",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-flame-600" />
                      {line}
                    </li>
                  ))}
                </ul>
                {category && (
                  <button type="button" onClick={() => pickCategory("")} className={`${pill} mt-6 bg-flame-600 text-white hover:bg-flame-700`}>
                    See all shops
                  </button>
                )}
              </div>
              {/* collage of what the shops make */}
              <div className="grid grid-cols-5 grid-rows-2 gap-2" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => {
                  const item = allProducts[i + 3] ?? allProducts[i];
                  const span = ["col-span-2", "col-span-3", "col-span-3", "col-span-2"][i];
                  const emoji = item ? productEmoji(item.product.name, item.shop.shop_category) : ["🍛", "🥤", "🍗", "🧁"][i];
                  return (
                    <div key={i} className={`${span} h-28 overflow-hidden rounded-xl shadow-md sm:h-36`}>
                      {item?.product.image_url ? (
                        <img src={item.product.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <PlateArt name={item ? `collage-${item.product.name}` : `collage-${i}`} emoji={emoji} className="h-full w-full" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mx-auto mt-12 max-w-6xl px-4">
              {shops.length === 0 ? (
                <div className="rounded-3xl bg-white px-6 py-14 text-center shadow-sm ring-1 ring-black/5">
                  <p className="text-5xl" aria-hidden="true">{category ? categoryOf(category).emoji : "🏪"}</p>
                  <p className="mt-3 text-lg font-medium text-pine-950">
                    {category ? `No ${categoryOf(category).label.toLowerCase()} shops are open right now` : "No shops are open right now"}
                  </p>
                  <p className="text-sm text-slate-500">Please check back a little later.</p>
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {shops.map((shop) => <ShopCard key={shop.id} shop={shop} inCart={cart.vendor_id === shop.id} />)}
                </div>
              )}
            </div>
          </section>

          {/* tea-time banner */}
          <section className="relative overflow-hidden bg-pine-900 px-4 py-16 text-center text-white">
            <span className="pointer-events-none absolute -left-6 top-1/2 -translate-y-1/2 text-[9rem] opacity-20 sm:left-10" aria-hidden="true">☕</span>
            <span className="pointer-events-none absolute -right-6 top-1/2 -translate-y-1/2 text-[9rem] opacity-20 sm:right-10" aria-hidden="true">🥟</span>
            <div className="relative mx-auto max-w-md">
              <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">Tea-time tastes better with snacks</h2>
              <p className="mt-3 text-sm leading-relaxed text-pine-100">
                {snacksOn
                  ? `4 PM Chayakadi combos are on until 6 PM, from ${inr(feed.pinned.min_order_value)}.`
                  : "4 PM Chayakadi brings snack and coolbar combos every day from 3 to 6 PM."}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (snacksOn && !category) return go("snacks");
                  pickCategory("BAKERY_COOLBAR");
                  go("categories");
                }}
                className={`${pill} mt-6 inline-flex items-center gap-2 bg-flame-600 text-white hover:bg-flame-700`}
              >
                {snacksOn ? "Order now" : "See snack shops"} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        </main>
      )}

      <StoreFooter />
    </div>
  );
}
