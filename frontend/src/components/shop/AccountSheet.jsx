import { ChevronRight, MapPin, Phone, ShieldCheck, Trash2, User } from "lucide-react";
import { forgetAllOrders, readProfile } from "./StorefrontContext.jsx";
import AppBar from "./AppBar.jsx";

const row = "flex w-full items-center gap-3 border-b border-slate-200 bg-white px-4 py-3.5 text-left";

/** Customers have no login: "Account" shows what this phone remembers and lets them change it. */
export default function AccountSheet({ onClose, onZones, place, orderCount, onClearedOrders }) {
  const profile = readProfile();
  return (
    <div className="fixed inset-x-0 bottom-16 top-0 z-[35] mx-auto flex max-w-md flex-col bg-slate-50 sm:border-x sm:border-slate-200" role="dialog" aria-label="Account">
      <AppBar title="Account" subtitle="Saved on this phone" onBack={onClose} />
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-slate-200 bg-white px-4 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><User className="h-6 w-6" /></span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-slate-900">{profile.name || "Guest"}</p>
              <p className="flex items-center gap-1 text-sm tabular-nums text-slate-500"><Phone className="h-3.5 w-3.5" />{profile.phone || "No phone saved yet"}</p>
            </div>
          </div>
          {profile.address && <p className="mt-3 text-sm text-slate-600">{profile.address}</p>}
        </div>
        <div className="h-2 bg-slate-100" />
        <button type="button" onClick={onZones} className={row}>
          <MapPin className="h-5 w-5 text-slate-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">Delivery location &amp; charges</span>
            <span className="block truncate text-xs text-slate-500">{place || "Not set"}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </button>
        <div className={row}>
          <ShieldCheck className="h-5 w-5 text-slate-500" />
          <span className="text-sm text-slate-700">Cash on delivery · no account or password needed</span>
        </div>
        <div className="h-2 bg-slate-100" />
        {orderCount > 0 && (
          <button
            type="button"
            onClick={() => { forgetAllOrders(); onClearedOrders?.(); }}
            className={`${row} text-red-600`}
          >
            <Trash2 className="h-5 w-5" />
            <span className="text-sm font-semibold">Clear order history on this phone</span>
          </button>
        )}
      </div>
    </div>
  );
}
