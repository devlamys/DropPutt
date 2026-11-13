import { Banknote, Loader2, MapPin, Plus, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api, { getErrorMessage, idempotencyHeaders } from "../utils/api.js";
import { inr } from "../utils/format.js";
import Stepper from "./shop/Stepper.jsx";
import { readProfile, saveProfile, useStorefront } from "./shop/StorefrontContext.jsx";
import { productEmoji } from "./shop/visuals.js";

const digits = (value) => value.replace(/\D/g, "");
const validPhone = (value) => {
  let d = digits(value);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d);
};

const press = "transition-transform active:scale-[0.98]";
const field =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";

const PAYMENTS = [
  {
    value: "COD",
    icon: Banknote,
    title: "Cash on Delivery",
    ml: "ഡെലിവറിയിൽ പണം നൽകാം",
    hint: "Pay the rider in cash when it arrives.",
  },
  {
    value: "UPI_TO_ADMIN",
    icon: Smartphone,
    title: "UPI",
    ml: "UPI വഴി പണമടയ്ക്കാം",
    hint: "Pay online to DropPutt. The rider won't ask you for cash.",
  },
];

function Section({ title, ml, children, action }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">
          {title} {ml && <span className="font-semibold text-slate-500">• {ml}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Cart + checkout in one modal: items, phone, turning point, delivery area,
 * payment (COD or UPI_TO_ADMIN), bill. Posts to POST /api/v1/marketplace/checkout;
 * on success the storefront redirects to the live tracking page /drop/:token.
 * Prices shown are for display; the server prices every line itself.
 */
export default function CartCheckoutModal({ cart, totals, zones, zoneId, onZone, minOrder, onQuantity, onAddMore, onClose, onPlaced }) {
  const { toast } = useStorefront();
  const profile = readProfile();
  const [phone, setPhone] = useState(profile.phone || "");
  const [name, setName] = useState(profile.name || "");
  const [turning, setTurning] = useState(profile.turning_point || "");
  const [house, setHouse] = useState(profile.house || "");
  const [payment, setPayment] = useState(profile.payment || "COD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [zonesTimedOut, setZonesTimedOut] = useState(false);
  // One key per attempt: a retry after a flaky network replays the same order.
  const attempt = useRef(null);

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

  useEffect(() => {
    if (zones.length) return undefined;
    const t = setTimeout(() => setZonesTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [zones.length]);

  const zone = zones.find((z) => String(z.id) === String(zoneId));
  const fee = zone ? Number(zone.delivery_fee) : null;
  const total = fee == null ? null : totals.subtotal + fee;
  const short = minOrder - totals.subtotal;
  const upi = payment === "UPI_TO_ADMIN";

  const problems = [];
  if (short > 0) problems.push(`Add ${inr(short)} more to reach the minimum order`);
  if (!validPhone(phone)) problems.push("Enter your 10-digit mobile number");
  if (turning.trim().length < 3) problems.push("Add a turning point or landmark near your house");
  if (!zone) problems.push("Choose your delivery area");
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
        "/marketplace/checkout",
        {
          vendor_id: cart.vendor_id,
          zone_id: Number(zoneId),
          customer_phone: phone,
          customer_name: name.trim() || undefined,
          turning_point: turning.trim(),
          drop_address: house.trim() || turning.trim(),
          payment_method: payment,
          items: cart.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        },
        { skipAuth: true, headers: attempt.current }
      );
      saveProfile({ phone, name: name.trim(), turning_point: turning.trim(), house: house.trim(), payment, zone_id: zoneId });
      onPlaced(data.data);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      toast?.(message, "error");
      // A rejected request deserves a fresh key; the next attempt may differ.
      if (err?.response?.status && err.response.status < 500) attempt.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 motion-safe:animate-fade-in" role="dialog" aria-modal="true" aria-label="Your cart">
      <form onSubmit={submit} noValidate className="flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl motion-safe:animate-sheet-up">
        <header className="flex items-center justify-between gap-3 bg-white px-5 py-4 shadow-sm">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-slate-900">Your cart <span className="font-bold text-slate-500">• നിങ്ങളുടെ കാർട്ട്</span></h2>
            <p className="truncate text-sm text-slate-500">{cart.shop_name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close cart" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 ${press}`}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <Section
            title={`${totals.count} item${totals.count === 1 ? "" : "s"}`}
            action={
              <button type="button" onClick={onAddMore} className={`flex h-12 items-center gap-1 px-2 text-sm font-bold text-emerald-700 ${press}`}>
                <Plus className="h-4 w-4" strokeWidth={3} /> Add more
              </button>
            }
          >
            <ul className="divide-y divide-slate-100">
              {cart.lines.map((line) => (
                <li key={line.product_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-2xl" aria-hidden="true">{productEmoji(line.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{line.name}</p>
                    <p className="text-xs tabular-nums text-slate-500">{inr(line.price)} each</p>
                  </div>
                  <Stepper compact quantity={line.quantity} label={line.name} onAdd={() => onQuantity(line.product_id, line.quantity + 1)} onRemove={() => onQuantity(line.product_id, line.quantity - 1)} />
                  <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums">{inr(Number(line.price) * line.quantity)}</span>
                </li>
              ))}
            </ul>
            {short > 0 && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">
                Minimum order here is <span className="tabular-nums">{inr(minOrder)}</span>. Add <span className="tabular-nums">{inr(short)}</span> more.
              </p>
            )}
          </Section>

          <Section title="Where to deliver" ml="എത്തിക്കേണ്ട സ്ഥലം">
            <div className="grid grid-cols-5 gap-2.5">
              <input className={`${field} col-span-3`} inputMode="numeric" autoComplete="tel" aria-label="Mobile number" placeholder="10-digit mobile" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={14} />
              <input className={`${field} col-span-2`} autoComplete="given-name" aria-label="Your name (optional)" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
            <label className="mt-2.5 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Turning point / landmark • ലാൻഡ്മാർക്ക്</span>
              <textarea className={field} rows={2} placeholder="e.g. After the old mosque, left turn, blue gate" value={turning} onChange={(e) => setTurning(e.target.value)} maxLength={300} />
            </label>
            <input className={`${field} mt-2.5`} aria-label="House name (optional)" placeholder="House name or number (optional)" value={house} onChange={(e) => setHouse(e.target.value)} maxLength={300} />
            <p className="mb-2 mt-3 text-xs font-semibold text-slate-600">Delivery area</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Delivery area">
              {zones.length === 0 && !zonesTimedOut && Array.from({ length: 3 }, (_, i) => <span key={i} className="h-12 w-40 animate-pulse rounded-full bg-slate-200" aria-hidden="true" />)}
              {zones.length === 0 && zonesTimedOut && <p className="text-sm text-slate-500">No delivery areas are set up yet. Please try again later.</p>}
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
                    className={`flex h-12 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-bold ${press} ${active ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"}`}
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    {z.zone_name.split("—").pop().trim()}
                    <span className="tabular-nums text-slate-500">· {inr(z.delivery_fee)}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">After ordering you can share your exact location and record a voice route for the rider.</p>
          </Section>

          <Section title="Pay with" ml="പണമടയ്ക്കൽ">
            <div className="space-y-2" role="radiogroup" aria-label="Payment method">
              {PAYMENTS.map((p) => {
                const Icon = p.icon;
                const on = payment === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPayment(p.value)}
                    className={`flex min-h-[3.5rem] w-full items-center gap-3 rounded-2xl border-2 p-3 text-left ${press} ${on ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"}`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${on ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold text-slate-900">{p.title} <span className="font-semibold text-slate-500">• {p.ml}</span></span>
                      <span className="block text-xs text-slate-600">{p.hint}</span>
                    </span>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-emerald-600" : "border-slate-300"}`} aria-hidden="true">
                      {on && <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Bill details" ml="ബിൽ">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Item total</dt><dd className="font-semibold tabular-nums">{inr(totals.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Delivery fee</dt><dd className="font-semibold tabular-nums">{fee == null ? "Choose area" : inr(fee)}</dd></div>
              <div className="mt-2 flex justify-between border-t border-dashed border-slate-300 pt-2 text-base">
                <dt className="font-extrabold text-slate-900">Total</dt>
                <dd className="font-extrabold tabular-nums text-slate-900">{total == null ? "—" : inr(total)}</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
              {upi ? (
                <>Pay <b className="tabular-nums">{total == null ? "the total" : inr(total)}</b> by UPI. Cash to the rider: <b className="tabular-nums">₹0</b>.</>
              ) : (
                <>Pay the rider <b className="tabular-nums">{total == null ? "the total" : inr(total)}</b> in cash. The rider confirms the final bill at the shop.</>
              )}
            </p>
          </Section>

          {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">{error}</p>}
        </div>

        <footer className="bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          {touched && blocked && <p className="mb-2 text-center text-sm font-semibold text-amber-800">{problems[0]}</p>}
          <button
            type="submit"
            disabled={busy}
            aria-disabled={blocked}
            aria-label={busy ? "Placing order" : `Place order, ${total == null ? inr(totals.subtotal) : inr(total)}, ${upi ? "UPI" : "cash on delivery"}`}
            className={`flex h-14 w-full items-center justify-between rounded-2xl px-5 text-white ${press} ${blocked ? "bg-slate-400" : "bg-emerald-600 shadow-lg shadow-emerald-900/25 hover:bg-emerald-700"}`}
          >
            <span className="text-base font-extrabold tabular-nums">{total == null ? inr(totals.subtotal) : inr(total)}</span>
            <span className="flex flex-col items-end leading-tight">
              <span className="flex items-center gap-2 text-base font-extrabold">
                {busy && <Loader2 className="h-5 w-5 animate-spin" />}
                {busy ? "Placing order…" : "Place Order"}
              </span>
              {!busy && <span className="text-[11px] font-semibold text-emerald-100">ഓർഡർ ചെയ്യാം</span>}
            </span>
          </button>
        </footer>
      </form>
    </div>
  );
}
