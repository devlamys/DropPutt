import { Bike, Loader2, MapPin, Truck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";
import { readProfile, saveProfile } from "./StorefrontContext.jsx";

const digits = (value) => value.replace(/\D/g, "");
const validPhone = (value) => {
  let d = digits(value);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d);
};

const KINDS = {
  PICK_DROP: {
    icon: Bike,
    title: "Pick & Drop",
    ml: "പിക്ക് & ഡ്രോപ്പ്",
    hint: "A rider collects a parcel or item and brings it to you.",
    detailsLabel: "What is being picked up?",
    detailsPlaceholder: "e.g. Documents from my brother, a bag from the tailor",
    needsPickup: true,
  },
  MINI_TRUCK: {
    icon: Truck,
    title: "Mini Truck",
    ml: "മിനി ട്രക്ക്",
    hint: "For furniture, sacks and other heavy loads.",
    detailsLabel: "What needs to be moved?",
    detailsPlaceholder: "e.g. A sofa and two chairs, 10 cement bags",
    needsPickup: true,
  },
};

/** Pick & Drop / Mini Truck request sheet. ("Buy Anything" has its own modal.) */
export default function CustomOrderSheet({ kind: initialKind, zones, zoneId, onZone, onClose, onPlaced }) {
  const profile = readProfile();
  const [kind, setKind] = useState(initialKind);
  const [details, setDetails] = useState("");
  const [pickup, setPickup] = useState("");
  const [address, setAddress] = useState(profile.address || "");
  const [phone, setPhone] = useState(profile.phone || "");
  const [name, setName] = useState(profile.name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  // One key per attempt: a retry after a flaky network replays the same order.
  const attempt = useRef(null);
  const cfg = KINDS[kind];
  const Icon = cfg.icon;

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  const zone = zones.find((z) => String(z.id) === String(zoneId));
  const problems = [];
  if (details.trim().length < 3) problems.push("Tell us what needs to be moved");
  if (cfg.needsPickup && pickup.trim().length < 3) problems.push("Where should the rider collect it?");
  if (!zone) problems.push("Choose your delivery area");
  if (address.trim().length < 3) problems.push("Add your address or a landmark");
  if (!validPhone(phone)) problems.push("Enter your 10-digit mobile number");
  const blocked = problems.length > 0;

  const submit = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (blocked || busy) return;
    setBusy(true);
    setError("");
    attempt.current ??= idempotencyHeaders();
    try {
      const { data } = await api.post(
        "/marketplace/orders",
        {
          order_type: kind,
          zone_id: Number(zoneId),
          customer_phone: phone,
          customer_name: name.trim() || undefined,
          drop_address: address.trim(),
          pickup_address: cfg.needsPickup ? pickup.trim() : undefined,
          details: details.trim(),
        },
        { skipAuth: true, headers: attempt.current }
      );
      saveProfile({ phone, name: name.trim(), address: address.trim(), zone_id: zoneId });
      onPlaced({ ...data.data, kind });
    } catch (err) {
      setError(getErrorMessage(err));
      if (err?.response?.status && err.response.status < 500) attempt.current = null;
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 motion-safe:animate-fade-in" role="dialog" aria-modal="true" aria-label={cfg.title}>
      <form onSubmit={submit} noValidate className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl motion-safe:animate-sheet-up">
        <header className="flex items-start justify-between gap-3 bg-white px-5 py-4 shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <Icon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900">
                {cfg.title} <span className="font-semibold text-slate-500">• {cfg.ml}</span>
              </h2>
              <p className="text-xs text-slate-500">{cfg.hint}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 active:scale-[0.98]">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-1.5 ring-1 ring-slate-200" role="radiogroup" aria-label="Type of pickup">
            {["PICK_DROP", "MINI_TRUCK"].map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`h-12 rounded-xl text-sm font-bold transition-transform active:scale-[0.98] ${kind === k ? "bg-emerald-600 text-white shadow" : "text-slate-600"}`}
              >
                {KINDS[k].title}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">{cfg.detailsLabel}</span>
            <textarea className={field} rows={3} placeholder={cfg.detailsPlaceholder} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} />
          </label>
          {cfg.needsPickup && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Collect from</span>
              <textarea className={field} rows={2} placeholder="Address or landmark where the rider should pick it up" value={pickup} onChange={(e) => setPickup(e.target.value)} maxLength={300} />
            </label>
          )}

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Deliver to • എത്തിക്കേണ്ട സ്ഥലം</span>
            <div className="mb-2.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Delivery area">
              {zones.map((z) => {
                const active = String(z.id) === String(zoneId);
                return (
                  <button
                    key={z.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${z.zone_name}, delivery ${inr(z.delivery_fee)}`}
                    onClick={() => onZone(z.id)}
                    className={`flex h-12 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-semibold transition-transform active:scale-[0.98] ${
                      active ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    {z.zone_name.split("—").pop().trim()}
                    <span className="tabular-nums text-slate-500">· {inr(z.delivery_fee)}</span>
                  </button>
                );
              })}
            </div>
            <textarea className={field} rows={2} placeholder="House name, nearest landmark" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
          </div>

          <div className="grid grid-cols-5 gap-2.5">
            <input className={`${field} col-span-3`} inputMode="numeric" autoComplete="tel" aria-label="Mobile number" placeholder="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={14} />
            <input className={`${field} col-span-2`} autoComplete="given-name" aria-label="Your name (optional)" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>

          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            Delivery from <b className="tabular-nums">{zone ? inr(zone.delivery_fee) : "₹30"}</b>
. The rider confirms the final amount with you before pickup. Pay cash on delivery.
          </p>
          {error && (
            <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">{error}</p>
          )}
        </div>

        <footer className="bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          {touched && blocked && <p className="mb-2 text-center text-sm font-medium text-amber-800">{problems[0]}</p>}
          <button
            type="submit"
            disabled={busy}
            aria-disabled={blocked}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold text-white transition-transform active:scale-[0.98] ${blocked ? "bg-slate-400" : "bg-emerald-600 shadow-lg shadow-emerald-900/20 hover:bg-emerald-700"}`}
          >
            {busy && <Loader2 className="h-5 w-5 animate-spin" />}
            {busy ? "Sending request…" : "Request a rider • റൈഡറെ വിളിക്കാം"}
          </button>
        </footer>
      </form>
    </div>
  );
}
