import AppBar, { SearchField } from "../components/shop/AppBar.jsx";
import { Store, Utensils } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import DishGrid from "../components/shop/DishGrid.jsx";
import MedicalNotice from "../components/shop/MedicalNotice.jsx";
import { useDebounced } from "../hooks/useDebounced.js";
import { useProducts } from "../hooks/useProducts.js";
import { useTheme } from "../hooks/useTheme.js";

const EMOJI = { GROCERY: "🛒", FISH_MEAT: "🐟", MEDICAL_PHARMACY: "💊" };

/** The Mart: groceries, fish & meat and medicines. Same design as the food home, in green. */
export default function MartPage() {
  useTheme("mart");
  const navigate = useNavigate();
  const [category, setCategory] = useState("");
  const [params] = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const q = useDebounced(query.trim(), 300);
  const list = useProducts({ group: "MART", category, q: q.length >= 2 ? q : "" });

  return (
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-44 text-slate-900 sm:border-x sm:border-slate-200">
      <AppBar
        title="DropPutt Mart"
        subtitle="Grocery · Fish & Meat · Medicines · മാർട്ട്"
        onBack={() => navigate("/shop")}
        label="Back to food"
        right={
          <button type="button" onClick={() => navigate("/shop")} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
            <Utensils className="h-4 w-4" /> Food
          </button>
        }
      >
        <SearchField value={query} onChange={setQuery} placeholder="Search rice, fish, paracetamol…" label="Search the Mart" />
      </AppBar>

      <main className="space-y-4 pt-4">
        <nav aria-label="Mart categories" className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[{ key: "", label: "All" }, ...list.categories].map((c) => {
            const on = category === c.key;
            return (
              <button
                key={c.key || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(c.key)}
                className={`flex h-11 shrink-0 items-center gap-1.5 rounded-lg border-2 px-4 text-sm font-bold transition-transform active:scale-[0.98] ${on ? "border-[#E8431A] bg-[#E8431A] text-white" : "border-slate-200 bg-white text-slate-700"}`}
              >
                {EMOJI[c.key] && <span aria-hidden="true">{EMOJI[c.key]}</span>}
                {c.label}
              </button>
            );
          })}
        </nav>

        <button type="button" onClick={() => navigate("/shop/restaurants?group=mart")} className="mx-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-lg bg-flame-50 p-3 text-left ring-1 ring-flame-200">
          <Store className="h-6 w-6 shrink-0 text-flame-700" />
          <span className="text-sm font-bold text-flame-900">Browse the stores <span className="font-semibold text-flame-700">· കടകൾ കാണൂ</span></span>
        </button>

        {category === "MEDICAL_PHARMACY" && <MedicalNotice className="mx-4" />}

        <div className="px-4">
          <DishGrid
            list={list}
            empty={
              <div className="rounded-xl bg-white px-5 py-12 text-center ring-1 ring-slate-200/70">
                <p className="text-5xl" aria-hidden="true">{EMOJI[category] ?? "🛒"}</p>
                <p className="mt-3 text-base font-bold">{q ? "Nothing matches your search" : "Nothing in stock right now"}</p>
                <p className="mt-1 text-sm text-slate-500">Stores may be closed. A rider can buy it for you from any shop in town.</p>
                <button type="button" onClick={() => navigate("/shop")} className="mt-4 h-12 rounded-lg bg-[#E8431A] px-6 text-sm font-bold text-white">Back to home</button>
              </div>
            }
          />
        </div>
      </main>
    </div>
  );
}
