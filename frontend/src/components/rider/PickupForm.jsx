import { Camera, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import api, { MULTIPART, getErrorMessage } from "../../utils/api.js";
import { PAYMENT_LABELS, inr } from "../../utils/format.js";
import { compressImage } from "../../utils/image.js";

/** Badge under the phone field: what we already know about this customer. */
function LookupBadge({ lookup, loading }) {
  if (loading) {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Looking up customer…
      </p>
    );
  }
  if (!lookup) return null;
  if (!lookup.found) {
    return <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">🆕 New customer — no saved location yet</p>;
  }
  return (
    <div className="mt-2 space-y-2">
      {lookup.is_location_verified ? (
        <p className="rounded-lg bg-green-100 px-3 py-2 text-sm font-semibold text-green-800">
          ✅ Verified Gate Location
          {lookup.turning_point && <span className="block font-normal">↪ {lookup.turning_point}</span>}
        </p>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Known customer{lookup.name ? ` (${lookup.name})` : ""} — gate location not verified yet
        </p>
      )}
      {lookup.voice_direction_url && (
        <div className="rounded-lg bg-blue-50 p-2">
          <p className="mb-1 text-xs font-semibold text-blue-800">🎙️ Recorded voice directions</p>
          <audio controls preload="none" src={lookup.voice_direction_url} className="w-full" />
        </div>
      )}
      {lookup.rider_delivery_note && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">📝 {lookup.rider_delivery_note}</p>
      )}
    </div>
  );
}

export default function PickupForm({ order, zones, onPickedUp, onError }) {
  const itemized = order.items.length > 0; // amount comes from the server
  const [photo, setPhoto] = useState(null);
  const [phone, setPhone] = useState(order.customer_phone ?? "");
  const [amount, setAmount] = useState(itemized ? order.item_total : "");
  const [payment, setPayment] = useState(order.payment_method || "COD");
  const [zoneId, setZoneId] = useState(order.zone_id ?? null);
  const [paidAtShop, setPaidAtShop] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  // Auto-lookup as soon as 10 digits are typed.
  useEffect(() => {
    setLookup(null);
    if (phone.length !== 10) return undefined;
    let cancelled = false;
    setLookingUp(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get("/orders/customer-lookup", { params: { phone } });
        if (!cancelled) setLookup(data.data);
      } catch {
        if (!cancelled) setLookup(null);
      } finally {
        if (!cancelled) setLookingUp(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phone]);

  async function onPhoto(event) {
    const file = event.target.files?.[0];
    if (file) setPhoto(await compressImage(file));
  }

  async function submit(event) {
    event.preventDefault();
    setProblem("");
    if (!photo) return setProblem("Take a photo of the bill first.");
    if (phone.length !== 10) return setProblem("Enter the 10-digit customer phone number.");
    if (!itemized && !(Number(amount) > 0)) return setProblem("Enter the bill amount.");
    if (!zoneId) return setProblem("Choose a delivery zone.");

    const form = new FormData();
    form.append("bill_image", photo);
    form.append("customer_phone", phone);
    form.append("zone_id", String(zoneId));
    form.append("payment_method", payment);
    if (!itemized) form.append("item_total", String(amount));
    if (order.order_type === "CUSTOM_BUY") form.append("rider_paid_at_shop", String(paidAtShop));

    setBusy(true);
    try {
      const { data } = await api.put(`/orders/${order.id}/rider-pickup`, form, MULTIPART);
      onPickedUp(data.data);
    } catch (error) {
      const message = getErrorMessage(error, "Could not save the pickup.");
      setProblem(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200";

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl bg-white p-4 shadow-sm ring-2 ring-blue-200">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Pickup · accepted</p>
        <h2 className="text-lg font-bold">
          {order.shop_name ?? "Order"} <span className="text-slate-400">#{order.order_number}</span>
        </h2>
        {order.pickup_address && <p className="text-sm text-slate-500">📍 {order.pickup_address}</p>}
      </div>

      {/* 1 — bill photo */}
      <div>
        <label className="mb-1 block text-sm font-semibold">1. Bill photo</label>
        <label className="flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500">
          {previewUrl ? (
            <img src={previewUrl} alt="Bill preview" className="max-h-48 w-full object-contain" />
          ) : (
            <>
              <Camera className="h-8 w-8" />
              <span className="text-sm font-medium">Tap to open camera</span>
            </>
          )}
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="sr-only" />
        </label>
        {photo && <p className="mt-1 text-xs text-slate-500">Tap the photo to retake.</p>}
      </div>

      {/* 2 — phone + lookup */}
      <div>
        <label htmlFor={`phone-${order.id}`} className="mb-1 block text-sm font-semibold">
          2. Customer phone
        </label>
        <input
          id={`phone-${order.id}`}
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          placeholder="10-digit number"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          className={field}
        />
        <LookupBadge lookup={lookup} loading={lookingUp} />
      </div>

      {/* 3 — amount */}
      <div>
        <label htmlFor={`amount-${order.id}`} className="mb-1 block text-sm font-semibold">
          3. Bill amount (₹)
        </label>
        <input
          id={`amount-${order.id}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="0"
          value={amount}
          readOnly={itemized}
          onChange={(e) => setAmount(e.target.value)}
          className={`${field} ${itemized ? "bg-slate-100" : ""}`}
        />
        {itemized && <p className="mt-1 text-xs text-slate-500">Calculated from the app order — {inr(order.item_total)}.</p>}
      </div>

      {/* 4 — payment + zone */}
      <div>
        <p className="mb-1 text-sm font-semibold">4. Payment method</p>
        <div className="grid gap-2">
          {Object.entries(PAYMENT_LABELS)
            .filter(([value]) => value !== "PREPAID_AT_HOTEL" || order.vendor_id)
            .map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPayment(value)}
                aria-pressed={payment === value}
                className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
                  payment === value
                    ? "border-orange-500 bg-orange-50 text-orange-800"
                    : "border-slate-300 text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold">Delivery zone</p>
        <div className="flex flex-wrap gap-2">
          {zones.map((zone) => (
            <button
              key={zone.id}
              type="button"
              onClick={() => setZoneId(zone.id)}
              aria-pressed={zoneId === zone.id}
              className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                zoneId === zone.id
                  ? "border-orange-600 bg-orange-600 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {zone.zone_name.split("—")[0].trim()} · {inr(zone.delivery_fee)}
            </button>
          ))}
        </div>
      </div>

      {order.order_type === "CUSTOM_BUY" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={paidAtShop} onChange={(e) => setPaidAtShop(e.target.checked)} className="h-5 w-5" />
          I paid the shop from my own pocket
        </label>
      )}

      {problem && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {problem}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 py-4 text-lg font-bold text-white shadow active:scale-95 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-5 w-5 animate-spin" />}
        Confirm pickup
      </button>
    </form>
  );
}
