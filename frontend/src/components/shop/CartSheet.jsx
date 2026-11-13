import { Banknote, Loader2, MapPin, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";
import { AddButton, ProductImage } from "./parts.jsx";
import { readProfile, saveProfile } from "./StorefrontContext.jsx";

const digits = (value) => value.replace(/\D/g, "");
const validPhone = (value) => {
  let d = digits(value);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d);
};

function Section({ title, children, action }) {
  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Cart + checkout in one sheet: items, delivery area, contact details, bill.
 * Prices here are for display; the server prices every line itself.
 */
export default function CartSheet({ cart, totals, shop, zones, zoneId, onZone, minOrder, onQuantity, onAddMore, onClose, onPlaced }) {
  const profile = readProfile();
  const [phone, setPhone] = useState(profile.phone || "");
  const [name, setName] = useState(profile.name || "");
  const [address, setAddress] = useState(profile.address || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  // One key per checkout attempt: retrying after a flaky network replays the
  // same order instead of creating a second one.
  const attempt = useRef(null);

  // Lock the page behind the sheet; close on Escape.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  const zone = zones.find((z) => String(z.id) === String(zoneId));
  const fee = zone ? Number(zone.delivery_fee) : null;
  const short = minOrder - totals.subtotal;

  const problems = [];
  if (short > 0) problems.push(`Add ${inr(short)} more to reach the minimum order`);
  if (!zone) problems.push("Choose your delivery area");
  if (!validPhone(phone)) problems.push("Enter your 10-digit mobile number");
  if (address.trim().length < 3) problems.push("Add your address or a landmark");
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
          drop_address: address.trim(),
          items: cart.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        },
        { skipAuth: true, headers: attempt.current }
      );
      saveProfile({ phone, name: name.trim(), address: address.trim(), zone_id: zoneId });
      onPlaced(data.data);
    } catch (err) {
      setError(getErrorMessage(err));
      // A rejected request deserves a fresh key: the next attempt may differ.
      if (err?.response?.status && err.response.status < 500) attempt.current = null;
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base outline-none transition placeholder:text-slate-400 focus:border-flame-500 focus:bg-white focus:ring-4 focus:ring-flame-100";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 motion-safe:animate-fade-in sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Your cart">
      <form
        onSubmit={submit}
        noValidate
        className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] bg-[#F3F3F0] font-display shadow-2xl motion-safe:animate-sheet-up sm:rounded-[2rem]"
      >
        <header className="flex items-center justify-between gap-3 bg-pine-900 px-5 py-4 text-white">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Your cart</h2>
            <p className="truncate text-sm text-pine-200">{cart.shop_name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close cart" className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          <Section
            title={`${totals.count} item${totals.count === 1 ? "" : "s"}`}
            action={
              <button type="button" onClick={onAddMore} className="flex items-center gap-1 text-sm font-bold text-flame-700">
                <Plus className="h-4 w-4" strokeWidth={3} /> Add more
              </button>
            }
          >
            <ul className="divide-y divide-slate-100">
              {cart.lines.map((line) => (
                <li key={line.product_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <ProductImage product={line} shopCategory={shop?.shop_category} className="h-12 w-12 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{line.name}</p>
                    <p className="text-xs text-slate-500">{inr(line.price)} each</p>
                  </div>
                  <AddButton
                    size="sm"
                    quantity={line.quantity}
                    label={line.name}
                    onAdd={() => onQuantity(line.product_id, line.quantity + 1)}
                    onRemove={() => onQuantity(line.product_id, line.quantity - 1)}
                  />
                  <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums">{inr(Number(line.price) * line.quantity)}</span>
                </li>
              ))}
            </ul>
            {short > 0 && (
              <p className="mt-3 rounded-xl bg-flame-50 px-3 py-2 text-sm font-medium text-flame-900">
                Minimum order here is {inr(minOrder)}. Add {inr(short)} more.
              </p>
            )}
          </Section>

          <Section title="Deliver to">
            <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Delivery area">
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
                    className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-2 text-left text-sm font-semibold transition ${
                      active ? "border-flame-600 bg-flame-50 text-pine-900" : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span>{z.zone_name.split("—").pop().trim()}</span>
                    <span className="text-slate-500">· {inr(z.delivery_fee)}</span>
                  </button>
                );
              })}
            </div>
            <div className="space-y-2.5">
              <label className="block">
                <span className="sr-only">Address or landmark</span>
                <textarea className={field} rows={2} placeholder="House name, nearest landmark" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
              </label>
              <div className="grid grid-cols-5 gap-2.5">
                <label className="col-span-3 block">
                  <span className="sr-only">Mobile number</span>
                  <input className={field} inputMode="numeric" autoComplete="tel" placeholder="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={14} />
                </label>
                <label className="col-span-2 block">
                  <span className="sr-only">Your name (optional)</span>
                  <input className={field} autoComplete="given-name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
                </label>
              </div>
              <p className="text-xs text-slate-500">
                After ordering you can share your exact location and record a voice route for the rider.
              </p>
            </div>
          </Section>

          <Section title="Bill details">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Item total</dt>
                <dd className="font-semibold tabular-nums">{inr(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Delivery fee</dt>
                <dd className="font-semibold tabular-nums">{fee == null ? "Choose area" : inr(fee)}</dd>
              </div>
              <div className="mt-2 flex justify-between border-t border-dashed border-slate-300 pt-2 text-base">
                <dt className="font-semibold">To pay</dt>
                <dd className="font-semibold tabular-nums">{fee == null ? "—" : inr(totals.subtotal + fee)}</dd>
              </div>
            </dl>
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              <Banknote className="h-4 w-4 shrink-0 text-flame-600" />
              Cash on delivery. The rider confirms the final bill at the shop.
            </p>
          </Section>

          {error && (
            <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
              {error}
            </p>
          )}
        </div>

        <footer className="bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          {touched && blocked && <p className="mb-2 text-center text-sm font-medium text-flame-800">{problems[0]}</p>}
          <button
            type="submit"
            disabled={busy}
            aria-disabled={blocked}
            aria-label={busy ? "Placing order" : `Place order, ${fee == null ? inr(totals.subtotal) : inr(totals.subtotal + fee)}`}
            className={`flex w-full items-center justify-between rounded-full px-6 py-4 text-base font-semibold text-white transition active:scale-[0.99] ${
              blocked ? "bg-slate-400" : "bg-flame-600 shadow-lg shadow-black/25"
            }`}
          >
            <span className="tabular-nums">{fee == null ? inr(totals.subtotal) : inr(totals.subtotal + fee)}</span>
            <span className="flex items-center gap-2">
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              {busy ? "Placing order…" : "Place order"}
            </span>
          </button>
        </footer>
      </form>
    </div>
  );
}

/** Shown for a moment after the order is accepted, before tracking opens. */
export function OrderPlaced({ order }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center pine-texture px-6 text-center text-white motion-safe:animate-fade-in" role="status">
      <svg viewBox="0 0 72 72" className="h-24 w-24 motion-safe:animate-scale-in" aria-hidden="true">
        <circle cx="36" cy="36" r="33" fill="white" />
        <path d="M22 37l10 10 19-21" fill="none" stroke="#D96A08" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="48" strokeDashoffset="48" className="motion-safe:animate-check-draw motion-reduce:[stroke-dashoffset:0]" />
      </svg>
      <h2 className="mt-6 text-2xl font-semibold">Order placed!</h2>
      <p className="mt-1 text-pine-100">
        {order.order_number} · {order.shop_name}
      </p>
      <p className="mt-4 text-sm text-pine-200">Finding a rider — opening your tracking page…</p>
    </div>
  );
}
