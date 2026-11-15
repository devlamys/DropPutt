/**
 * The items of an order and how many of each. `big` is the "read this out at
 * the counter" version for riders buying from a shop that is not on the app.
 */
export default function OrderItemList({ items, big = false, title }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={big ? "rounded-xl border-2 border-orange-300 bg-orange-50 p-3" : "rounded-xl bg-slate-50 p-3"}>
      {title && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-orange-800">{title}</p>}
      <ul className={big ? "space-y-1.5 text-lg font-bold" : "space-y-1 text-sm"}>
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex items-baseline gap-3">
            <span className={big ? "min-w-[2.5rem] text-orange-700" : "min-w-[2rem] font-semibold text-slate-700"}>{item.quantity}×</span>
            <span className="min-w-0 break-words">{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
