import { Minus, Plus } from "lucide-react";

/** "ADD" that turns into a − n + stepper (emerald, 48 px tall). */
export default function Stepper({ quantity, onAdd, onRemove, label, compact = false }) {
  const width = compact ? "min-w-[6rem]" : "min-w-[7rem]";
  if (!quantity) {
    return (
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${label}`}
        className={`h-12 ${compact ? "min-w-[5rem]" : "min-w-[5.5rem]"} rounded-2xl border-2 border-emerald-600 bg-white px-4 text-sm font-bold text-emerald-700 transition-transform active:scale-[0.98]`}
      >
        ADD
      </button>
    );
  }
  return (
    <div className={`flex h-12 ${width} items-center justify-between rounded-2xl bg-emerald-600 text-white motion-safe:animate-pop`}>
      <button type="button" onClick={onRemove} aria-label={`Remove one ${label}`} className="flex h-12 w-11 items-center justify-center">
        <Minus className="h-4 w-4" strokeWidth={3} />
      </button>
      <span className="font-bold tabular-nums" aria-live="polite">{quantity}</span>
      <button type="button" onClick={onAdd} aria-label={`Add one more ${label}`} className="flex h-12 w-11 items-center justify-center">
        <Plus className="h-4 w-4" strokeWidth={3} />
      </button>
    </div>
  );
}
