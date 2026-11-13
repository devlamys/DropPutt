import { Loader2 } from "lucide-react";
import { useState } from "react";
import api, { getErrorMessage } from "../utils/api.js";
import Modal from "./Modal.jsx";

const REASONS = {
  VENDOR: ["Out of stock", "Shop is closing", "Wrong order"],
  FRANCHISE_ADMIN: ["Customer unreachable", "No rider available", "Duplicate order", "Shop cannot prepare it"],
};

/**
 * Cancel one order (shop: before pickup; admin: any time before delivery).
 * The server decides what is allowed; its message is shown if the order moved on.
 */
export default function CancelOrderModal({ order, role, onClose, onCancelled, toast }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await api.post(`/orders/${order.id}/cancel`, reason.trim() ? { reason: reason.trim() } : {});
      toast(`Order #${order.order_number} cancelled`, "success");
      onCancelled();
    } catch (error) {
      toast(getErrorMessage(error, "Could not cancel this order."), "error");
      onCancelled(); // the order may have changed (e.g. a rider picked it up): refresh the board
    } finally {
      setBusy(false);
    }
  }

  const holdsRider = order.order_status !== "RIDER_REQUESTED";

  return (
    <Modal title={`Cancel #${order.order_number}?`} onClose={onClose} dismissible={!busy}>
      <p className="mb-3 text-sm text-slate-600">
        {holdsRider
          ? "The rider is already on this order and will be told it was cancelled."
          : "Riders who are being alerted will stop seeing it."}{" "}
        No money moves for a cancelled order.
      </p>

      <div className="mb-2 flex flex-wrap gap-2">
        {(REASONS[role] ?? REASONS.FRANCHISE_ADMIN).map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => setReason(text)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
              reason === text ? "bg-orange-100 text-orange-800 ring-orange-300" : "bg-slate-50 text-slate-600 ring-slate-200"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      <input
        type="text"
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        aria-label="Reason"
        className="mb-4 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-2xl border border-slate-300 py-3 font-bold text-slate-700 disabled:opacity-60"
        >
          Keep order
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="flex items-center justify-center rounded-2xl bg-red-600 py-3 font-bold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Cancel order"}
        </button>
      </div>
    </Modal>
  );
}
