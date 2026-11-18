import { Minus, Plus } from "lucide-react";

/** Swiggy-style [ ADD ] that turns into a − n + stepper. Brand #E8431A, crisp rounded-lg. */
export default function Stepper({ quantity, onAdd, onRemove, label, compact = false }) {
  const width = compact ? "w-[5.5rem]" : "w-28";
  if (!quantity) {
    return (
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${label}`}
        className={`h-9 ${width} rounded-lg border border-[#E8431A] bg-white text-xs font-bold tracking-wide text-[#E8431A] active:bg-orange-50`}
      >
        ADD
      </button>
    );
  }
  return (
    <div className={`flex h-9 ${width} items-center justify-between rounded-lg border border-[#E8431A] bg-white text-[#E8431A]`}>
      <button type="button" onClick={onRemove} aria-label={`Remove one ${label}`} className="flex h-9 w-9 items-center justify-center">
        <Minus className="h-4 w-4" strokeWidth={3} />
      </button>
      <span className="text-sm font-bold tabular-nums" aria-live="polite">{quantity}</span>
      <button type="button" onClick={onAdd} aria-label={`Add one more ${label}`} className="flex h-9 w-9 items-center justify-center">
        <Plus className="h-4 w-4" strokeWidth={3} />
      </button>
    </div>
  );
}
