import { Check, MapPin } from "lucide-react";
import { inr } from "../../utils/format.js";
import Modal from "../Modal.jsx";

/** Pick the delivery area; the fee is shown up front. */
export default function ZoneSheet({ zones, value, onPick, onClose }) {
  return (
    <Modal title="Where should we deliver?" onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-slate-500">The delivery fee depends on your area.</p>
      <ul className="space-y-2">
        {zones.map((zone) => {
          const active = String(zone.id) === String(value);
          return (
            <li key={zone.id}>
              <button
                type="button"
                onClick={() => onPick(zone.id)}
                aria-pressed={active}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition ${
                  active ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                  {active ? <Check className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                </span>
                <span className="min-w-0 flex-1 font-semibold">{zone.zone_name}</span>
                <span className="shrink-0 text-sm font-bold">{inr(zone.delivery_fee)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {zones.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No delivery areas are set up yet.</p>}
    </Modal>
  );
}
