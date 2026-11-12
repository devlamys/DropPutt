import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";
import Modal from "../Modal.jsx";

const PROFILE_KEY = "dropputt.customer";
const readProfile = () => {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
  } catch {
    return {};
  }
};

const MIN_ORDER_HINT = 0; // the server enforces the minimum; its message is shown as-is

export default function CheckoutSheet({ cart, subtotal, zones, minOrder, onClose, onPlaced }) {
  const saved = readProfile();
  const [phone, setPhone] = useState(saved.phone || "");
  const [name, setName] = useState(saved.name || "");
  const [address, setAddress] = useState(saved.address || "");
  const [zoneId, setZoneId] = useState(saved.zone_id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per checkout attempt: a retry after a flaky network replays the
  // same order instead of creating a second one.
  const attempt = useRef(null);

  const zone = zones.find((z) => String(z.id) === String(zoneId));
  const fee = zone ? Number(zone.delivery_fee) : null;
  const belowMin = minOrder > MIN_ORDER_HINT && subtotal < minOrder;
  const phoneOk = /^[6-9]\d{9}$/.test(phone.replace(/\D/g, "").slice(-10)) && phone.replace(/\D/g, "").length >= 10;
  const canSubmit = phoneOk && address.trim().length >= 3 && zone && !busy && !belowMin;

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
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
      try {
        localStorage.setItem(
          PROFILE_KEY,
          JSON.stringify({ phone, name: name.trim(), address: address.trim(), zone_id: zoneId })
        );
      } catch {
        /* ignore */
      }
      onPlaced(data.data);
    } catch (err) {
      setError(getErrorMessage(err));
      // A rejected request (validation) deserves a fresh key; the next
      // attempt may send different content.
      if (err?.response?.status && err.response.status < 500) attempt.current = null;
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-xl border border-slate-300 px-3 py-3 text-base focus:border-orange-500 focus:outline-none";
  return (
    <Modal title="Your order" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm font-semibold text-slate-700">{cart.shop_name}</p>
        <ul className="divide-y divide-slate-100 rounded-xl bg-slate-50 px-3 text-sm">
          {cart.lines.map((l) => (
            <li key={l.product_id} className="flex justify-between py-2">
              <span>
                {l.quantity} × {l.name}
              </span>
              <span className="font-medium">{inr(Number(l.price) * l.quantity)}</span>
            </li>
          ))}
        </ul>

        <label className="block text-sm font-medium">
          Mobile number
          <input
            className={field}
            inputMode="numeric"
            autoComplete="tel"
            placeholder="10-digit mobile"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={14}
          />
        </label>
        <label className="block text-sm font-medium">
          Name (optional)
          <input className={field} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </label>
        <label className="block text-sm font-medium">
          Delivery area
          <select className={field} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="">Choose your area…</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.zone_name} — {inr(z.delivery_fee)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Address / landmark
          <textarea
            className={field}
            rows={2}
            placeholder="House name, nearest landmark"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={300}
          />
        </label>

        <div className="space-y-1 rounded-xl bg-orange-50 p-3 text-sm">
          <div className="flex justify-between">
            <span>Items</span>
            <span>{inr(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Delivery</span>
            <span>{fee == null ? "choose area" : inr(fee)}</span>
          </div>
          <div className="flex justify-between border-t border-orange-200 pt-1 text-base font-bold">
            <span>Pay on delivery</span>
            <span>{fee == null ? "—" : inr(subtotal + fee)}</span>
          </div>
          <p className="text-xs text-slate-500">Cash to the rider. The rider confirms the final bill at the shop.</p>
        </div>

        {belowMin && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Minimum order for this shop is {inr(minOrder)}.
          </p>
        )}
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 py-4 text-lg font-bold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-5 w-5 animate-spin" />}
          Place order
        </button>
      </form>
    </Modal>
  );
}
