import { ArrowLeft, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DishGrid from "../components/shop/DishGrid.jsx";
import MedicalNotice from "../components/shop/MedicalNotice.jsx";
import { categoryOf } from "../components/shop/visuals.js";
import { useDebounced } from "../hooks/useDebounced.js";
import { useProducts } from "../hooks/useProducts.js";
import { useTheme } from "../hooks/useTheme.js";
import { inr } from "../utils/format.js";

/** One shop's dishes: the same list as the home page, filtered to this shop. */
export default function ShopDishes() {
  const { vendorId } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const list = useProducts({ vendorId: Number(vendorId), q: q.length >= 2 ? q : "" });
  const shop = list.shop;
  useTheme(shop && !["HOTEL", "BAKERY_COOLBAR"].includes(shop.shop_category) ? "mart" : null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [vendorId]);

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-32 text-slate-900 shadow-xl">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/shop"))} aria-label="Back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold leading-tight">{shop?.shop_name ?? "Shop"}</h1>
            {shop && (
              <p className="truncate text-xs text-slate-500">
                {categoryOf(shop.shop_category).label}
                {shop.address ? ` · ${shop.address.split(",")[0]}` : ""} · Min {inr(shop.min_order_value)}
                {shop.is_open ? "" : " · Closed now"}
              </p>
            )}
          </div>
        </div>
        <label className="mt-3 flex h-11 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 focus-within:border-flame-500 focus-within:bg-white">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <span className="sr-only">Search in this shop</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in this shop" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden" />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600"><X className="h-4 w-4" /></button>
          )}
        </label>
      </header>
      <main className="px-4 pt-4">
        {shop?.shop_category === "MEDICAL_PHARMACY" && <MedicalNotice className="mb-3" />}
        <DishGrid
          list={list}
          empty={
            <div className="rounded-2xl bg-white px-5 py-12 text-center shadow-sm ring-1 ring-slate-200/70">
              <p className="text-5xl" aria-hidden="true">{shop && !shop.is_open ? "🌙" : "🍽️"}</p>
              <p className="mt-3 text-base font-bold">{shop && !shop.is_open ? "This shop is closed right now" : q ? "No dish matches your search" : "Nothing to order here right now"}</p>
              <p className="mt-1 text-sm text-slate-500">Other shops may be open. Try the home page.</p>
              <button type="button" onClick={() => navigate("/shop")} className="mt-4 h-12 rounded-2xl bg-flame-600 px-6 text-sm font-bold text-white">Back to home</button>
            </div>
          }
        />
      </main>
    </div>
  );
}
