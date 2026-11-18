import AppBar, { SearchField } from "../components/shop/AppBar.jsx";
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
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-44 text-slate-900 sm:border-x sm:border-slate-200">
      <AppBar
        title={shop?.shop_name ?? "Shop"}
        subtitle={shop ? `${categoryOf(shop.shop_category).label}${shop.address ? ` · ${shop.address.split(",")[0]}` : ""} · Min ${inr(shop.min_order_value)}${shop.is_open ? "" : " · Closed now"}` : undefined}
      >
        <SearchField value={query} onChange={setQuery} placeholder="Search in this shop" label="Search in this shop" />
      </AppBar>
      <main className="px-4 pt-4">
        {shop?.shop_category === "MEDICAL_PHARMACY" && <MedicalNotice className="mb-3" />}
        <DishGrid
          list={list}
          empty={
            <div className="rounded-xl bg-white px-5 py-12 text-center ring-1 ring-slate-200/70">
              <p className="text-5xl" aria-hidden="true">{shop && !shop.is_open ? "🌙" : "🍽️"}</p>
              <p className="mt-3 text-base font-bold">{shop && !shop.is_open ? "This shop is closed right now" : q ? "No dish matches your search" : "Nothing to order here right now"}</p>
              <p className="mt-1 text-sm text-slate-500">Other shops may be open. Try the home page.</p>
              <button type="button" onClick={() => navigate("/shop")} className="mt-4 h-12 rounded-lg bg-[#E8431A] px-6 text-sm font-bold text-white">Back to home</button>
            </div>
          }
        />
      </main>
    </div>
  );
}
