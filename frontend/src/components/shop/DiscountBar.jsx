import { BadgePercent } from "lucide-react";
import { inr } from "../../utils/format.js";

/**
 * "Add ₹X more to get ₹Y off delivery": a range bar from ₹0 to the franchise's discount threshold.
 * `rule` is { min, amount } from the server (null = no discount, nothing is shown).
 */
export default function DiscountBar({ rule, subtotal, className = "" }) {
  if (!rule) return null;
  const min = Number(rule.min);
  const amount = Number(rule.amount);
  if (!(min > 0) || !(amount > 0)) return null;
  const reached = subtotal >= min;
  const pct = Math.min(100, Math.round((subtotal / min) * 100));
  return (
    <div className={`rounded-xl bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-200 ${className}`} role="status">
      <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-900">
        <BadgePercent className="h-4 w-4 shrink-0" />
        {reached ? (
          <span>You get <span className="tabular-nums">{inr(amount)}</span> off delivery</span>
        ) : (
          <span>Add <span className="tabular-nums">{inr(min - subtotal)}</span> more to get <span className="tabular-nums">{inr(amount)}</span> off delivery</span>
        )}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-200" role="progressbar" aria-label="Progress to the delivery discount" aria-valuemin={0} aria-valuemax={min} aria-valuenow={Math.min(subtotal, min)}>
        <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-semibold tabular-nums text-emerald-800">
        <span>{inr(0)}</span>
        <span>{inr(min)}</span>
      </div>
    </div>
  );
}
