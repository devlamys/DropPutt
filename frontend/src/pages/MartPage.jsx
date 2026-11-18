import { ArrowLeft, Search, Store, Utensils, X } from "lucide-react";
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
    <div className="mx-auto min-h-screen max-w-md bg-slate-50 pb-32 text-slate-900 shadow-xl">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate("/shop")} aria-label="Back to food" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-flame-50 text-flame-700">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-extrabold leading-tight text-flame-700">DropPutt Mart</h1>
            <p className="truncate text-xs text-slate-500">Grocery · Fish &amp; Meat · Medicines · മാർട്ട്</p>
          </div>
          <button type="button" onClick={() => navigate("/shop")} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
            <Utensils className="h-4 w-4" /> Food
          </button>
        </div>
        <label className="mt-3 flex h-11 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 focus-within:border-flame-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-flame-100">
          <Search className="h-5 w-5 shrink-0 text-slate-400" />
          <span className="sr-only">Search the Mart</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rice, fish, paracetamol…" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden" />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-600"><X className="h-4 w-4" /></button>
          )}
        </label>
      </header>

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
                className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-bold transition-transform active:scale-[0.98] ${on ? "border-flame-600 bg-flame-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}
              >
                {EMOJI[c.key] && <span aria-hidden="true">{EMOJI[c.key]}</span>}
                {c.label}
              </button>
            );
          })}
        </nav>

        <button type="button" onClick={() => navigate("/shop/restaurants?group=mart")} className="mx-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl bg-flame-50 p-3 text-left ring-1 ring-flame-200">
          <Store className="h-6 w-6 shrink-0 text-flame-700" />
          <span className="text-sm font-bold text-flame-900">Browse the stores <span className="font-semibold text-flame-700">· കടകൾ കാണൂ</span></span>
        </button>

        {category === "MEDICAL_PHARMACY" && <MedicalNotice className="mx-4" />}

        <div className="px-4">
          <DishGrid
            list={list}
            empty={
              <div className="rounded-2xl bg-white px-5 py-12 text-center shadow-sm ring-1 ring-slate-200/70">
                <p className="text-5xl" aria-hidden="true">{EMOJI[category] ?? "🛒"}</p>
                <p className="mt-3 text-base font-bold">{q ? "Nothing matches your search" : "Nothing in stock right now"}</p>
                <p className="mt-1 text-sm text-slate-500">Stores may be closed. A rider can buy it for you from any shop in town.</p>
                <button type="button" onClick={() => navigate("/shop")} className="mt-4 h-12 rounded-2xl bg-flame-600 px-6 text-sm font-bold text-white">Back to home</button>
              </div>
            }
          />
        </div>
      </main>
    </div>
  );
}
