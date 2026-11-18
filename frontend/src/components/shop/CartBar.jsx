import { inr } from "../../utils/format.js";

/** Sticky strip right above the bottom nav: "2 ITEMS | ₹280" and "View Cart →". */
export default function CartBar({ cart, totals, minOrder, onOpen }) {
  if (totals.count === 0) return null;
  const short = minOrder - totals.subtotal;
  const progress = minOrder > 0 ? Math.min(100, Math.round((totals.subtotal / minOrder) * 100)) : 100;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 mx-auto max-w-md px-3 pb-2 font-display">
      <div className="pointer-events-auto motion-safe:animate-sheet-up">
        {short > 0 && (
          <div className="mb-2 rounded-xl border border-slate-200 bg-white px-3 pb-2 pt-1.5 text-xs font-semibold text-slate-700">
            Add <span className="tabular-nums">{inr(short)}</span> more to reach {cart.shop_name}'s minimum order
            <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-slate-100">
              <div className="h-full bg-[#E8431A] transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <button type="button" onClick={onOpen} aria-label={`View cart, ${totals.count} item${totals.count === 1 ? "" : "s"}, ${inr(totals.subtotal)}`} className="flex h-12 w-full items-center justify-between rounded-xl bg-[#E8431A] px-4 text-white active:bg-[#cf3a14]">
          <span className="text-sm font-bold uppercase tracking-wide tabular-nums">
            {totals.count} item{totals.count === 1 ? "" : "s"} <span className="px-1 opacity-70">|</span> {inr(totals.subtotal)}
          </span>
          <span className="text-sm font-bold">View Cart →</span>
        </button>
      </div>
    </div>
  );
}
