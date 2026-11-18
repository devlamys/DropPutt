import { ArrowLeft, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ShopCard from "../components/shop/ShopCard.jsx";
import { useTheme } from "../hooks/useTheme.js";
import { useStorefront } from "../components/shop/StorefrontContext.jsx";

const FOOD_SHOPS = ["HOTEL", "BAKERY_COOLBAR"];

/** Every open restaurant (and, greyed out at the end, the closed ones). `?group=mart` lists grocery, fish and medical shops. */
export default function RestaurantsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mart = params.get("group") === "mart";
  useTheme(mart ? "mart" : null);
  const { vendors, closedVendors, loading, feed, cart } = useStorefront();
  const [query, setQuery] = useState("");
  const inGroup = (v) => (FOOD_SHOPS.includes(v.shop_category) ? !mart : mart);
  const q = query.trim().toLowerCase();
  const match = (v) => inGroup(v) && (!q || v.shop_name.toLowerCase().includes(q));
  const open = vendors.filter(match);
  const closed = closedVendors.filter(match);
  const go = (id) => navigate(`/shop/restaurant/${id}`);

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-32 text-slate-900 shadow-xl">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/shop"))} aria-label="Back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-extrabold">{mart ? "Grocery, fish & medical" : "Open restaurants"}</h1>
        </div>
        <label className="mt-3 flex h-11 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 focus-within:border-flame-500 focus-within:bg-white">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <span className="sr-only">Search shops</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shops" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden" />
        </label>
      </header>
      <main className="space-y-6 px-4 pt-4">
        {loading && !feed ? (
          <p className="py-16 text-center text-sm text-slate-500">Loading shops…</p>
        ) : open.length === 0 && closed.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">No shop found.</p>
        ) : (
          <>
            <section aria-label="Open shops">
              <h2 className="mb-3 text-lg font-extrabold">Open now · <span className="tabular-nums">{open.length}</span></h2>
              {open.length === 0 ? <p className="text-sm text-slate-500">No shop is open right now.</p> : (
                <div className="space-y-3">{open.map((s) => <ShopCard key={s.id} shop={s} inCart={cart.vendor_id === s.id} onOpen={go} />)}</div>
              )}
            </section>
            {closed.length > 0 && (
              <section aria-label="Closed shops">
                <h2 className="mb-3 text-base font-extrabold text-slate-500">Closed right now · <span className="tabular-nums">{closed.length}</span></h2>
                <div className="space-y-3">{closed.map((s) => <ShopCard key={s.id} shop={s} closed />)}</div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
