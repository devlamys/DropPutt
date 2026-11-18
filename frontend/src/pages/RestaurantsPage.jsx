import AppBar, { SearchField } from "../components/shop/AppBar.jsx";
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
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-44 text-slate-900 sm:border-x sm:border-slate-200">
      <AppBar title={mart ? "Grocery, fish & medical" : "Open restaurants"}>
        <SearchField value={query} onChange={setQuery} placeholder="Search shops" label="Search shops" />
      </AppBar>
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
