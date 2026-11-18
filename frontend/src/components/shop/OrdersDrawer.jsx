import { ChevronRight, PackageOpen } from "lucide-react";
import AppBar from "./AppBar.jsx";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api.js";
import { ORDER_STATUS_LABELS } from "../../utils/format.js";
import { forgetOrder, readOrders } from "./StorefrontContext.jsx";

const POLL_MS = 20_000;
const TONE = {
  RIDER_REQUESTED: "bg-amber-100 text-amber-800",
  RIDER_ASSIGNED: "bg-sky-100 text-sky-800",
  PICKED_UP: "bg-emerald-100 text-emerald-800",
  LOCATION_SHARED: "bg-emerald-100 text-emerald-800",
  DELIVERED: "bg-slate-100 text-slate-600",
  CANCELLED: "bg-red-100 text-red-700",
};
const KIND_LABEL = { CUSTOM_BUY: "Buy Anything", PICK_DROP: "Pick & Drop", MINI_TRUCK: "Mini Truck" };

const ago = (at) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/** Orders placed from this device, with live status (public, token-based). */
export default function OrdersDrawer({ onClose }) {
  const [orders, setOrders] = useState(readOrders);
  const [status, setStatus] = useState({}); // token -> { order_status, message }

  const refresh = useCallback(async () => {
    const list = readOrders();
    const results = await Promise.all(
      list.map((o) =>
        api
          .get(`/public/drop/${o.token}/status`, { skipAuth: true })
          .then(({ data }) => [o.token, { order_status: data.data.order_status, message: data.data.estimated_message }])
          .catch((err) => {
            if (err?.response?.status === 404) forgetOrder(o.token); // link no longer valid
            return [o.token, null];
          })
      )
    );
    setStatus(Object.fromEntries(results.filter(([, v]) => v)));
    setOrders(readOrders());
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [refresh, onClose]);

  return (
    <div className="fixed inset-x-0 bottom-16 top-0 z-[35] mx-auto flex max-w-md flex-col bg-slate-50 sm:border-x sm:border-slate-200" role="dialog" aria-label="My orders">
      <AppBar title="My Orders" subtitle="എന്റെ ഓർഡറുകൾ · on this phone" onBack={onClose} />
      <div className="flex-1 overflow-y-auto p-4">
          {orders.length === 0 ? (
            <div className="mt-16 text-center">
              <PackageOpen className="mx-auto h-14 w-14 text-slate-300" />
              <p className="mt-4 font-bold text-slate-900">No orders yet</p>
              <p className="mt-1 text-sm text-slate-500">Orders you place from this phone will show up here, with live status.</p>
              <button type="button" onClick={onClose} className="mt-6 h-12 rounded-lg bg-[#E8431A] px-6 text-sm font-bold text-white transition-transform active:scale-[0.98]">
                Start ordering
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {orders.map((o) => {
                const live = status[o.token];
                const code = live?.order_status;
                return (
                  <li key={o.token}>
                    <Link
                      to={`/drop/${o.token}`}
                      onClick={onClose}
                      className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-4 transition-transform active:scale-[0.98]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-bold text-slate-900">{o.shop || KIND_LABEL[o.kind] || "Order"}</p>
                          {code ? (
                            <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold ${TONE[code] ?? "bg-slate-100 text-slate-600"}`}>{ORDER_STATUS_LABELS[code] ?? code}</span>
                          ) : (
                            <span className="h-4 w-16 shrink-0 animate-pulse rounded-full bg-slate-100" aria-label="Loading status" />
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {o.number} · {ago(o.at)}
                        </p>
                        {live?.message && <p className="mt-1 text-xs font-medium text-slate-600">{live.message}</p>}
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
    </div>
  );
}
