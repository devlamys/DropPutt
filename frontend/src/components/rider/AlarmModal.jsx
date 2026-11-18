import { BellRing, Loader2 } from "lucide-react";
import { useState } from "react";
import Modal from "../Modal.jsx";

/** Full-screen order alert. The looping sound runs while this is mounted. */
const REQUEST_LABELS = {
  CUSTOM_BUY: "🛒 Shopping request — list shown after you accept",
  PICK_DROP: "📦 Pick & drop — details shown after you accept",
  MINI_TRUCK: "🚚 Mini truck — details shown after you accept",
};

export default function AlarmModal({ request, queued, onAccept, onDismiss }) {
  const [busy, setBusy] = useState(false);
  const addon = request.kind === "addon";

  async function accept() {
    setBusy(true);
    try {
      await onAccept(request);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={addon ? (request.same_customer ? "🔥 Same customer: add-on" : "🔥 Add-on Order on your route!") : "🛵 New delivery request"}
      tone="alert"
      dismissible={false}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl bg-orange-50 p-4">
          <BellRing className="h-8 w-8 shrink-0 animate-bounce text-orange-600" />
          <div className="min-w-0 text-sm">
            {request.shop_name && <p className="truncate text-base font-bold">{request.shop_name}</p>}
            {request.order_number && <p className="text-slate-600">Order #{request.order_number}</p>}
            {request.item_count > 0 && (
              <p className="font-semibold text-slate-800">
                🍽️ {request.item_count} item{request.item_count === 1 ? "" : "s"}
              </p>
            )}
            {!(request.item_count > 0) && REQUEST_LABELS[request.order_type] && (
              <p className="font-semibold text-slate-800">{REQUEST_LABELS[request.order_type]}</p>
            )}
            {request.pickup_address && <p className="truncate text-slate-600">📍 {request.pickup_address}</p>}
            {request.message && <p className="font-semibold text-orange-700">{request.message}</p>}
          </div>
        </div>
        {queued > 0 && <p className="text-center text-xs text-slate-500">+{queued} more waiting</p>}
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => onDismiss(request)}
            disabled={busy}
            className="rounded-2xl border border-slate-300 py-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="col-span-2 flex items-center justify-center gap-2 rounded-2xl bg-green-600 py-4 text-lg font-bold text-white shadow active:scale-95 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-5 w-5 animate-spin" />}
            Accept
          </button>
        </div>
      </div>
    </Modal>
  );
}
