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
      <div className="pointer-events-auto mx-auto max-w-xl font-display motion-safe:animate-sheet-up">
        {short > 0 && (
          <div className="mb-2 rounded-2xl bg-flame-50 px-4 pb-2.5 pt-2 text-xs font-medium text-flame-900 shadow-lg ring-1 ring-flame-200">
            Add {inr(short)} more to reach {cart.shop_name}'s minimum order
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-flame-200">
              <div className="h-full rounded-full bg-flame-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-3 rounded-full bg-pine-900 py-2.5 pl-3 pr-5 text-left text-white shadow-xl shadow-black/30 ring-1 ring-white/10 transition active:scale-[0.99]"
        >
          <span className="flex -space-x-2">
            {cart.lines.slice(0, 3).map((line) => (
              <span key={line.product_id} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl ring-2 ring-pine-900" aria-hidden="true">
                {productEmoji(line.name, shopCategory)}
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {totals.count} item{totals.count === 1 ? "" : "s"} · {inr(totals.subtotal)}
            </span>
            <span className="block truncate text-xs text-pine-200">{cart.shop_name}</span>
          </span>
          <span className="flex items-center gap-0.5 rounded-full bg-flame-600 px-3 py-1.5 text-sm font-semibold">
            View cart <ChevronRight className="h-4 w-4" strokeWidth={3} />
          </span>
        </button>
      </div>
    </div>
  );
}
