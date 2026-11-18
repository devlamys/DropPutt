import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * Native-style sticky top bar for every inner view: ← back, bold title, optional right action.
 * `children` render under the bar inside the same sticky block (search boxes, filter chips).
 * Without `onBack`, ← goes to the previous page, or to the shop home when there is none.
 */
export default function AppBar({ title, subtitle, onBack, right, children, label = "Back" }) {
  const navigate = useNavigate();
  const back = onBack ?? (() => (window.history.length > 1 ? navigate(-1) : navigate("/shop")));
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-1 pl-1 pr-3">
        <button type="button" onClick={back} aria-label={label} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-900 active:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight text-slate-900">{title}</h1>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children && <div className="px-4 pb-3">{children}</div>}
    </header>
  );
}

/** Rounded-lg search field used under an AppBar. */
export function SearchField({ value, onChange, placeholder, label }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-[#E8431A] focus-within:bg-white">
      <span className="sr-only">{label}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden" />
    </label>
  );
}
