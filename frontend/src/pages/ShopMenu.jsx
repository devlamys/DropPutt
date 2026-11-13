import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { StoreFooter, StoreNav } from "../components/shop/chrome.jsx";
import { PlateArt, ProductImage, ProductRow, Skeleton } from "../components/shop/parts.jsx";
import { useStorefront } from "../components/shop/StorefrontContext.jsx";
import { categoryOf } from "../components/shop/visuals.js";
import { inr } from "../utils/format.js";

function MenuSection({ title, count, children }) {
  return (
    <section className="rounded-2xl bg-white px-5 shadow-sm ring-1 ring-black/5">
      <h2 className="flex items-baseline gap-2 border-b border-slate-100 py-4 text-lg font-medium text-pine-950">
        {title}
        <span className="text-xs font-medium text-slate-400">{count}</span>
      </h2>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
  );
}

/** One shop's full menu: what can be ordered now, and what comes back later. */
export default function ShopMenu() {
  const { vendorId } = useParams();
  const { feed, shopById, loading, quantityOf, addProduct, removeOne } = useStorefront();
  const [query, setQuery] = useState("");
  const shop = shopById.get(Number(vendorId));

  useEffect(() => {
    window.scrollTo(0, 0);
    setQuery("");
  }, [vendorId]);

  const nav = (
    <StoreNav query={query} onQuery={setQuery} searchPlaceholder={shop ? `Search in ${shop.shop_name}` : "Search this menu"} />
  );

  if (loading && !feed) {
    return (
      <div>
        {nav}
        <div className="mx-auto max-w-3xl space-y-4 p-4" aria-busy="true">
          <Skeleton className="h-44" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!shop) {
    return (
      <div>
        {nav}
        <div className="mx-auto max-w-md px-6 py-24 text-center">
          <p className="text-6xl" aria-hidden="true">🌙</p>
          <h1 className="mt-4 text-xl font-medium text-pine-950">This shop is closed right now</h1>
          <p className="mt-1 text-sm text-slate-500">It isn't taking orders at the moment. Other shops are open.</p>
          <Link to="/shop" className="mt-6 inline-block rounded-full bg-flame-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-flame-700">
            Browse open shops
          </Link>
        </div>
        <StoreFooter />
      </div>
    );
  }

  const cat = categoryOf(shop.shop_category);
  const q = query.trim().toLowerCase();
  const match = (p) => !q || p.name.toLowerCase().includes(q);
  const snackWindow = Boolean(feed?.is_chayakadi_window);
  const available = shop.products.filter(match);
  const specials = snackWindow ? available.filter((p) => p.slot_type === "EVENING_SNACKS_3_TO_6") : [];
  const regular = available.filter((p) => !specials.includes(p));
  const later = (shop.unavailable ?? []).filter(match);
  const cover = [...shop.products, ...(shop.unavailable ?? [])].slice(0, 3);

  const row = (product) => (
    <ProductRow
      key={product.id}
      product={product}
      shop={shop}
      quantity={quantityOf(product.id)}
      onAdd={() => addProduct(product, shop.shop_name)}
      onRemove={() => removeOne(product.id)}
    />
  );

  return (
    <div>
      {nav}

      {/* shop header band */}
      <section className="pine-texture relative px-4 pb-24 pt-8 text-white sm:pb-28">
        <div className="mx-auto max-w-3xl">
          <Link to="/shop" className="inline-flex items-center gap-2 text-sm text-pine-100 transition hover:text-flame-300">
            <ArrowLeft className="h-4 w-4" /> All shops
          </Link>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-flame-300">{cat.label}</p>
          <h1 className="mt-2 text-3xl font-medium uppercase leading-tight tracking-tight sm:text-4xl">{shop.shop_name}</h1>
          {shop.address && <p className="mt-2 text-sm text-pine-100">{shop.address}</p>}
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
            <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-pine-900">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Open now
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/25">Minimum order {inr(shop.min_order_value)}</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/25">Cash on delivery</span>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 translate-y-1/2 px-4" aria-hidden="true">
          <div className="mx-auto grid h-24 max-w-3xl grid-cols-3 gap-1.5 sm:h-32 sm:gap-2">
            {[0, 1, 2].map((i) => {
              const shape = i === 0 ? "rounded-l-full" : i === 2 ? "rounded-r-full" : "";
              const item = cover[i];
              return (
                <div key={i} className={`h-full w-full overflow-hidden shadow-xl ring-2 ring-white ${shape}`}>
                  {item ? (
                    <ProductImage product={item} shopCategory={shop.shop_category} className="h-full w-full" />
                  ) : (
                    <PlateArt name={`${shop.shop_name}-${i}`} emoji={cat.emoji} className="h-full w-full" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-20 sm:pt-24">
        {q && (
          <p className="text-sm text-slate-500">
            Showing results for "{query.trim()}" in this menu.{" "}
            <button type="button" onClick={() => setQuery("")} className="font-semibold text-flame-700 underline-offset-2 hover:underline">
              Clear
            </button>
          </p>
        )}
        {specials.length > 0 && <MenuSection title="☕ 4 PM specials" count={specials.length}>{specials.map(row)}</MenuSection>}
        {regular.length > 0 && <MenuSection title={specials.length ? "Menu" : "Available now"} count={regular.length}>{regular.map(row)}</MenuSection>}
        {later.length > 0 && (
          <MenuSection title="Not available right now" count={later.length}>
            {later.map((product) => <ProductRow key={product.id} product={product} shop={shop} unavailable={product} />)}
          </MenuSection>
        )}
        {available.length === 0 && later.length === 0 && (
          <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm ring-1 ring-black/5">
            <p className="text-5xl" aria-hidden="true">{q ? "🔍" : "🍽️"}</p>
            <p className="mt-3 font-medium text-pine-950">{q ? `Nothing on this menu matches "${query.trim()}"` : "This shop has nothing on its menu yet"}</p>
          </div>
        )}
      </main>

      <StoreFooter />
    </div>
  );
}
