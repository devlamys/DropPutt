import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import CancelOrderModal from "../CancelOrderModal.jsx";
import StatusBadge from "../StatusBadge.jsx";

function ageLabel(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${minutes % 60} min`;
}

/** Orders that need a human: nobody took them, or a rider has held them for hours. */
export default function StuckOrders({ orders, onChanged, toast }) {
  const [cancelling, setCancelling] = useState(null);
  if (!orders?.length) return null;

  return (
    <section aria-labelledby="stuck-heading" className="mb-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-300">
      <h2 id="stuck-heading" className="mb-2 flex items-center gap-2 font-bold text-amber-900">
        <AlertTriangle className="h-5 w-5" /> Needs attention ({orders.length})
      </h2>
      <p className="mb-3 text-xs text-amber-800">
        Unaccepted orders are re-sent to riders every few minutes and cancelled automatically after a while.
        Orders a rider already holds are never cancelled for you.
      </p>
      <ul className="divide-y divide-amber-200">
        {orders.map((order) => (
          <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="font-semibold">
                #{order.order_number} <span className="font-normal text-slate-600">· {order.shop_name ?? "Custom request"}</span>
              </p>
              <p className="text-xs text-slate-600">
                Waiting {ageLabel(order.age_minutes)}
                {order.rider_name ? ` · rider ${order.rider_name}` : " · no rider yet"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={order.order_status} />
              <button
                type="button"
                onClick={() => setCancelling(order)}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-red-600 ring-1 ring-red-200 hover:bg-red-50"
              >
                Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>

      {cancelling && (
        <CancelOrderModal
          order={cancelling}
          role="FRANCHISE_ADMIN"
          toast={toast}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
