import { ArrowLeft, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ProductRow, Skeleton } from "../components/shop/parts.jsx";
import { useStorefront } from "../components/shop/StorefrontContext.jsx";
import { categoryOf, productEmoji } from "../components/shop/visuals.js";
import { inr } from "../utils/format.js";

function MenuSection({ title, count, children }) {
  return (
    <section className="rounded-3xl bg-white px-4 shadow-sm ring-1 ring-black/5">
      <h2 className="flex items-baseline gap-2 border-b border-slate-100 py-3 text-base font-extrabold">
        {title}
        <span className="text-xs font-semibold text-slate-400">{count}</span>
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
  }, [vendorId]);

  if (loading && !feed) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4" aria-busy="true">
        <Skeleton className="h-40 !rounded-3xl" />
        <Skeleton className="h-12" />
        <Skeleton className="h-64 !rounded-3xl" />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="text-6xl" aria-hidden="true">🌙</p>
        <h1 className="mt-4 text-xl font-extrabold">This shop is closed right now</h1>
        <p className="mt-1 text-sm text-slate-500">It isn't taking orders at the moment. Other shops are open.</p>
        <Link to="/shop" className="mt-6 inline-block rounded-2xl bg-orange-600 px-6 py-3 font-bold text-white">
          Browse open shops
        </Link>
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
  const cover = [...shop.products, ...(shop.unavailable ?? [])].slice(0, 4);

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
    <div className="mx-auto max-w-2xl">
      {/* cover */}
      <div className={`relative flex h-44 items-center justify-center gap-2 bg-gradient-to-br ${cat.cover} sm:mt-4 sm:rounded-3xl`}>
        <Link to="/shop" aria-label="Back to all shops" className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-md backdrop-blur transition active:scale-95">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {(cover.length ? cover : [{ name: cat.label }]).map((p, i) => (
          <span key={p.id ?? i} className="text-6xl drop-shadow" style={{ transform: `rotate(${(i - 1.5) * 7}deg)` }} aria-hidden="true">
            {productEmoji(p.name, shop.shop_category)}
          </span>
        ))}
      </div>

      {/* shop card */}
      <div className="relative z-10 -mt-8 px-4">
        <div className="rounded-3xl bg-white p-5 shadow-md ring-1 ring-black/5">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-black leading-tight tracking-tight">{shop.shop_name}</h1>
            <span className="mt-1.5 flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Open now
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {cat.label}
            {shop.address ? ` · ${shop.address}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
            <span className="rounded-full bg-slate-100 px-3 py-1.5">Minimum order {inr(shop.min_order_value)}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">Cash on delivery</span>
          </div>
        </div>
      </div>

      {/* in-menu search */}
      <div className="sticky top-0 z-20 bg-[#FFF9F2]/95 px-4 py-3 backdrop-blur">
        <label className="flex items-center gap-3 rounded-2xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-orange-400">
          <Search className="h-5 w-5 shrink-0 text-orange-600" />
          <span className="sr-only">Search this menu</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search in ${shop.shop_name}`}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="rounded-full bg-slate-100 p-1 text-slate-500">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
      </div>

      <div className="space-y-4 px-4">
        {specials.length > 0 && (
          <MenuSection title="☕ 4 PM specials" count={specials.length}>{specials.map(row)}</MenuSection>
        )}
        {regular.length > 0 && (
          <MenuSection title={specials.length ? "Menu" : "Available now"} count={regular.length}>{regular.map(row)}</MenuSection>
        )}
        {later.length > 0 && (
          <MenuSection title="Not available right now" count={later.length}>
            {later.map((product) => (
              <ProductRow key={product.id} product={product} shop={shop} unavailable={product} />
            ))}
          </MenuSection>
        )}
        {available.length === 0 && later.length === 0 && (
          <div className="rounded-3xl bg-white px-6 py-12 text-center shadow-sm ring-1 ring-black/5">
            <p className="text-5xl" aria-hidden="true">{q ? "🔍" : "🍽️"}</p>
            <p className="mt-3 font-bold">{q ? `Nothing on this menu matches "${query.trim()}"` : "This shop has nothing on its menu yet"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
