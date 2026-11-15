import { MapPin } from "lucide-react";
import { inr } from "../../utils/format.js";
import Modal from "../Modal.jsx";

/**
 * Delivery charges by distance from the shop. Information only: at checkout the
 * customer shares a location and the charge is worked out from it.
 */
export default function ZoneSheet({ zones, onClose }) {
  let from = 0;
  return (
    <Modal title="Delivery charges" onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-slate-500">The charge depends on how far your home is from the shop. You will see it as soon as you choose your location.</p>
      <ul className="space-y-2">
        {zones.map((zone) => {
          const upTo = Number(zone.max_km);
          const label = `${from}–${upTo} km`;
          from = upTo;
          return (
            <li key={zone.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <MapPin className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1 font-semibold">{label}</span>
              <span className="shrink-0 text-sm font-bold">{inr(zone.delivery_fee)}</span>
            </li>
          );
        })}
      </ul>
      {zones.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Delivery charges are being set up.</p>}
    </Modal>
  );
}
