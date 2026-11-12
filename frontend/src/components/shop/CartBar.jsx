import { ChevronRight } from "lucide-react";
import { inr } from "../../utils/format.js";
import { productEmoji } from "./visuals.js";

/** Floating summary above the bottom edge; opens the cart. */
export default function CartBar({ cart, totals, minOrder, shopCategory, onOpen }) {
  if (totals.count === 0) return null;
  const short = minOrder - totals.subtotal;
  const progress = minOrder > 0 ? Math.min(100, Math.round((totals.subtotal / minOrder) * 100)) : 100;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto mx-auto max-w-xl motion-safe:animate-sheet-up">
        {short > 0 && (
          <div className="mx-3 rounded-t-2xl bg-amber-50 px-4 pb-2 pt-2 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
            Add {inr(short)} more to reach {cart.shop_name}'s minimum order
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-amber-200">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-3 rounded-2xl bg-emerald-600 py-3 pl-3 pr-4 text-left text-white shadow-xl shadow-emerald-900/20 transition active:scale-[0.99]"
        >
          <span className="flex -space-x-2">
            {cart.lines.slice(0, 3).map((line) => (
              <span key={line.product_id} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-xl ring-2 ring-emerald-600" aria-hidden="true">
                {productEmoji(line.name, shopCategory)}
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">
              {totals.count} item{totals.count === 1 ? "" : "s"} · {inr(totals.subtotal)}
            </span>
            <span className="block truncate text-xs text-emerald-100">{cart.shop_name}</span>
          </span>
          <span className="flex items-center gap-0.5 text-sm font-extrabold">
            View cart <ChevronRight className="h-4 w-4" strokeWidth={3} />
          </span>
        </button>
      </div>
    </div>
  );
}
