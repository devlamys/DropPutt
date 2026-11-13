/** Brief confirmation shown after an order is accepted, just before tracking opens. */
export default function OrderPlaced({ order }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-emerald-600 px-6 text-center text-white motion-safe:animate-fade-in" role="status">
      <svg viewBox="0 0 72 72" className="h-24 w-24 motion-safe:animate-scale-in" aria-hidden="true">
        <circle cx="36" cy="36" r="33" fill="white" />
        <path d="M22 37l10 10 19-21" fill="none" stroke="#059669" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="48" strokeDashoffset="48" className="motion-safe:animate-check-draw motion-reduce:[stroke-dashoffset:0]" />
      </svg>
      <h2 className="mt-6 text-2xl font-extrabold">Order placed! • ഓർഡർ ലഭിച്ചു</h2>
      <p className="mt-1 text-emerald-50">
        {order.order_number} · {order.shop_name}
      </p>
      <p className="mt-4 text-sm text-emerald-100">Opening live tracking…</p>
    </div>
  );
}
