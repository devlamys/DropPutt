import { ArrowLeft, Banknote, Loader2, Plus, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api, { getErrorMessage, idempotencyHeaders } from "../utils/api.js";
import { inr } from "../utils/format.js";
import DiscountBar from "./shop/DiscountBar.jsx";
import LocationPicker from "./shop/LocationPicker.jsx";
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
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";

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
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 ">
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
export default function CartCheckoutModal({ cart, totals, shop, minOrder, onQuantity, onAddMore, onClose, onPlaced, carts = [], activeId, onSelect, minOrderOf }) {
  const { toast, feed } = useStorefront();
  const profile = readProfile();
  const [phone, setPhone] = useState(profile.phone || "");
  const [name, setName] = useState(profile.name || "");
  const [turning, setTurning] = useState(profile.turning_point || "");
  const [house, setHouse] = useState(profile.house || "");
  const [payment, setPayment] = useState(profile.payment || "COD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  // Where to deliver: the zone and the fee come from the distance, never from a choice.
  const [pin, setPin] = useState(profile.lat != null && profile.lng != null ? { lat: profile.lat, lng: profile.lng } : null);
  const [quote, setQuote] = useState(null);
  // Several shops in the cart: deliver them together (one rider trip, one extra-stop fee) or as separate orders.
  const MAX_TOGETHER = 3;
  const canTogether = carts.length >= 2 && carts.length <= MAX_TOGETHER;
  const [mode, setMode] = useState("together");
  const together = canTogether && mode === "together";
  const [groupQuote, setGroupQuote] = useState(null); // { together_fee, separate_fee, shops } | { error }
  // One key per attempt: a retry after a flaky network replays the same order.
  const attempt = useRef(null);
  // Another shop's cart is a different order: it must not replay this key.
  useEffect(() => {
    attempt.current = null;
  }, [cart.vendor_id, together]);

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

  const groupKey = together && pin ? `${carts.map((c) => c.vendor_id).join(",")}@${pin.lat},${pin.lng}` : "";
  useEffect(() => {
    if (!groupKey) {
      setGroupQuote(null);
      return undefined;
    }
    let live = true;
    setGroupQuote(null);
    const timer = setTimeout(() => {
      api
        .post("/marketplace/group-quote", { vendor_ids: carts.map((c) => c.vendor_id), lat: pin.lat, lng: pin.lng }, { skipAuth: true })
        .then(({ data }) => live && setGroupQuote(data.data))
        .catch((err) => live && setGroupQuote({ error: getErrorMessage(err, "We cannot deliver all these shops to this location") }));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey]);

  // What the bill is made of: this one cart, or every cart when delivering together.
  const subtotalOf = (c) => c.lines.reduce((sum, l) => sum + Math.round(Number(l.price) * 100) * l.quantity, 0) / 100;
  const billItems = together ? carts.reduce((sum, c) => sum + subtotalOf(c), 0) : totals.subtotal;
  const billCount = together ? carts.reduce((n, c) => n + c.lines.reduce((m, l) => m + l.quantity, 0), 0) : totals.count;
  const shortCarts = together ? carts.map((c) => ({ c, short: (minOrderOf?.(c) ?? 0) - subtotalOf(c) })).filter((x) => x.short > 0) : [];

  const deliverable = together ? Boolean(groupQuote && !groupQuote.error) : Boolean(quote?.deliverable);
  const fee = deliverable ? Number(together ? groupQuote.together_fee : quote.delivery_fee) : null;
  // Far bands can ask for a bigger order than the shop does; the delivery discount (a range bar) is for single-shop orders.
  const zoneMin = together ? 0 : Number(quote?.min_order_value ?? 0);
  const effectiveMin = Math.max(minOrder, zoneMin);
  const rule = together ? null : (quote?.delivery_discount ?? feed?.delivery_discount ?? null);
  const discount = deliverable && rule && totals.subtotal >= Number(rule.min) ? Math.min(Number(rule.amount), fee) : 0;
  const total = fee == null ? null : billItems + fee - discount;
  const short = together ? 0 : effectiveMin - totals.subtotal;
  const upi = payment === "UPI_TO_ADMIN";

  const problems = [];
  if (short > 0) problems.push(zoneMin > minOrder ? `Orders to this distance need at least ${inr(zoneMin)}. Add ${inr(short)} more` : `Add ${inr(short)} more to reach the minimum order`);
  for (const { c, short: s2 } of shortCarts) problems.push(`Add ${inr(s2)} more from ${c.shop_name} to reach its minimum order`);
  if (!validPhone(phone)) problems.push("Enter your 10-digit mobile number");
  if (turning.trim().length < 3) problems.push("Add a turning point or landmark near your house");
  if (!pin) problems.push("Choose your delivery location on the map");
  else if (together && groupQuote?.error) problems.push(groupQuote.error);
  else if (together && !groupQuote) problems.push("Wait for the delivery charge to appear");
  else if (!together && quote && !quote.deliverable) problems.push(quote.message || "We cannot deliver to this location");
  else if (!together && !quote) problems.push("Wait for the delivery charge to appear");
  const blocked = problems.length > 0;

  const submit = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (blocked || busy) return;
    setBusy(true);
    setError("");
    attempt.current ??= idempotencyHeaders();
    try {
      const common = {
        drop_lat: pin.lat,
        drop_lng: pin.lng,
        customer_phone: phone,
        customer_name: name.trim() || undefined,
        turning_point: turning.trim(),
        drop_address: house.trim() || turning.trim(),
        payment_method: payment,
      };
      const { data } = together
        ? await api.post(
            "/marketplace/checkout-group",
            { ...common, carts: carts.map((c) => ({ vendor_id: c.vendor_id, items: c.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })) })) },
            { skipAuth: true, headers: attempt.current }
          )
        : await api.post(
            "/marketplace/checkout",
            { ...common, vendor_id: cart.vendor_id, items: cart.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })) },
            { skipAuth: true, headers: attempt.current }
          );
      saveProfile({ phone, name: name.trim(), turning_point: turning.trim(), house: house.trim(), payment, lat: pin.lat, lng: pin.lng });
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
      <form onSubmit={submit} noValidate className="flex h-full w-full max-w-md flex-col overflow-hidden bg-slate-50 motion-safe:animate-sheet-up">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white pl-1 pr-4">
          <button type="button" onClick={onClose} disabled={busy} aria-label="Back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-900 active:bg-slate-100">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-slate-900">Your cart</h2>
            <p className="truncate text-xs text-slate-500">{together ? carts.map((c) => c.shop_name).join(" + ") : cart.shop_name}</p>
          </div>
        </header>

        {carts.length > 1 && (
          <div className="shrink-0 space-y-2 border-b border-slate-200 bg-white px-4 py-2">
            {canTogether && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to deliver">
                {[
                  { key: "together", title: "Deliver together", hint: "One rider, one trip" },
                  { key: "separate", title: "Separate orders", hint: "Each shop on its own" },
                ].map((o) => (
                  <button key={o.key} type="button" role="radio" aria-checked={mode === o.key} disabled={busy} onClick={() => setMode(o.key)} className={`rounded-lg border px-3 py-2 text-left ${mode === o.key ? "border-2 border-[#E8431A] bg-orange-50" : "border-slate-200 bg-white"}`}>
                    <span className="block text-sm font-bold text-slate-900">{o.title}</span>
                    <span className="block text-[11px] text-slate-500">{o.hint}</span>
                  </button>
                ))}
              </div>
            )}
            {!together && (
              <>
                <p className="text-xs text-slate-500">Each shop is a separate order with its own delivery charge.</p>
                <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Your carts">
                  {carts.map((c) => {
                    const on = c.vendor_id === activeId;
                    const n = c.lines.reduce((sum, l) => sum + l.quantity, 0);
                    return (
                      <button key={c.vendor_id} type="button" role="tab" aria-selected={on} disabled={busy} onClick={() => onSelect?.(c.vendor_id)} className={`h-9 shrink-0 rounded-lg border px-3 text-sm font-bold ${on ? "border-[#E8431A] bg-[#E8431A] text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                        {c.shop_name} <span className="tabular-nums opacity-80">({n})</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {(together ? carts : [cart]).map((c) => {
            const count = c.lines.reduce((n, l) => n + l.quantity, 0);
            const min = together ? (minOrderOf?.(c) ?? 0) : effectiveMin;
            const cShort = min - subtotalOf(c);
            return (
              <Section
                key={c.vendor_id}
                title={together ? `${c.shop_name} · ${count} item${count === 1 ? "" : "s"}` : `${count} item${count === 1 ? "" : "s"}`}
                action={
                  <button type="button" onClick={() => onAddMore(c.vendor_id)} className={`flex h-12 items-center gap-1 px-2 text-sm font-bold text-emerald-700 ${press}`}>
                    <Plus className="h-4 w-4" strokeWidth={3} /> Add more
                  </button>
                }
              >
                <ul className="divide-y divide-slate-100">
                  {c.lines.map((line) => (
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
                {cShort > 0 && (
                  <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">
                    {!together && zoneMin > minOrder ? "Orders to this distance need at least" : "Minimum order here is"} <span className="tabular-nums">{inr(min)}</span>. Add <span className="tabular-nums">{inr(cShort)}</span> more.
                  </p>
                )}
              </Section>
            );
          })}

          <DiscountBar rule={rule} subtotal={billItems} />

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
            <p className="mb-2 mt-3 text-xs font-semibold text-slate-600">Delivery location • ഡെലിവറി ലൊക്കേഷൻ</p>
            <LocationPicker
              shop={together ? null : shop}
              hideCharge={together}
              pin={pin}
              onChange={(next, nextQuote) => {
                setPin(next);
                setQuote(nextQuote);
              }}
            />
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
                    className={`flex min-h-[3.5rem] w-full items-center gap-3 rounded-xl border-2 p-3 text-left ${press} ${on ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"}`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${on ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold text-slate-900">{p.title} <span className="font-semibold text-slate-500">• {p.ml}</span></span>
                      <span className="block text-xs text-slate-600">{p.hint}</span>
                    </span>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border-2 ${on ? "border-emerald-600" : "border-slate-300"}`} aria-hidden="true">
                      {on && <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Bill details" ml="ബിൽ">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Item total</dt><dd className="font-semibold tabular-nums">{inr(billItems)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Delivery fee{together ? " (one trip)" : ""}</dt><dd className="font-semibold tabular-nums">{fee == null ? "Set location" : inr(fee)}</dd></div>
              {discount > 0 && (
                <div className="flex justify-between text-green-700"><dt>Delivery discount</dt><dd className="font-semibold tabular-nums">− {inr(discount)}</dd></div>
              )}
              {together && groupQuote && !groupQuote.error && Number(groupQuote.separate_fee) > Number(groupQuote.together_fee) && (
                <div className="flex justify-between text-green-700"><dt>Saved vs separate orders</dt><dd className="font-semibold tabular-nums">{inr(Number(groupQuote.separate_fee) - Number(groupQuote.together_fee))}</dd></div>
              )}
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

          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">{error}</p>}
        </div>

        <footer className="bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 border-t border-slate-200">
          {touched && blocked && <p className="mb-2 text-center text-sm font-semibold text-amber-800">{problems[0]}</p>}
          <button
            type="submit"
            disabled={busy}
            aria-disabled={blocked}
            aria-label={busy ? "Placing order" : `Place order, ${total == null ? inr(totals.subtotal) : inr(total)}, ${upi ? "UPI" : "cash on delivery"}`}
            className={`flex h-14 w-full items-center justify-between rounded-xl px-5 text-white ${press} ${blocked ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            <span className="text-base font-extrabold tabular-nums">{total == null ? inr(billItems) : inr(total)}</span>
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
