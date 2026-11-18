import { CheckCircle2, Loader2, MessageCircle, Phone, Radio } from "lucide-react";
import { useState } from "react";
import Modal from "../Modal.jsx";
import StatusBadge from "../StatusBadge.jsx";
import api, { getErrorMessage } from "../../utils/api.js";
import { PAYMENT_LABELS, inr } from "../../utils/format.js";
import RequestDetails from "./RequestDetails.jsx";
import RouteMap from "./RouteMap.jsx";

function whatsappUrl(order) {
  const link = `${window.location.origin}/drop/${order.location_token}`;
  const text =
    `നമസ്കാരം! നിങ്ങളുടെ ഓർഡർ #${order.order_number} വരുന്നുണ്ട്. ` +
    `കൃത്യമായ ലൊക്കേഷൻ പങ്കിടാൻ ഈ ലിങ്ക് തുറക്കുക:\n${link}\n\n` +
    `Your order is on the way. Open this link to share your location and track the rider.`;
  const digits = String(order.customer_phone || "").replace(/\D/g, "").slice(-10);
  return `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`;
}

export default function ActiveDeliveryCard({ order, riderPosition, tracking, onDeliver, onPaymentChanged }) {
  const nav = order.navigation;
  const [changing, setChanging] = useState(false);
  return (
    <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-2 ring-violet-200">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold">
            {order.customer_name || "Customer"} <span className="text-slate-400">#{order.order_number}</span>
          </h2>
          <p className="text-sm text-slate-500">
            {order.shop_name ? `From ${order.shop_name}` : "Custom order"}
            {order.is_batched_addon && " · 🔥 add-on"}
            {order.group_id && " · 🔗 one trip, several shops"}
          </p>
        </div>
        <StatusBadge status={order.order_status} />
      </div>

      {/* §14.4: the hotel hands the rider the delivery fee at pickup */}
      {Number(order.collect_from_hotel) > 0 && (
        <p className="rounded-xl bg-green-50 p-3 text-center text-sm font-bold text-green-800 ring-1 ring-green-200">
          Take your {inr(order.collect_from_hotel)} delivery fee from {order.shop_name ?? "the hotel"} now
        </p>
      )}

      {/* money to collect */}
      <div className="rounded-xl bg-orange-50 p-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">
          Collect from customer
        </p>
        <p className="text-3xl font-extrabold text-orange-700">{inr(order.amount_to_collect)}</p>
        <p className="text-xs text-slate-600">{PAYMENT_LABELS[order.payment_method]}</p>
        <button type="button" onClick={() => setChanging(true)} className="mt-1 text-xs font-semibold text-orange-700 underline">
          Wrong payment method? Change
        </button>
      </div>
      {changing && (
        <PaymentMethodModal
          order={order}
          onClose={() => setChanging(false)}
          onChanged={(data) => {
            setChanging(false);
            onPaymentChanged?.(data);
          }}
        />
      )}

      {/* what the rider keeps and what goes to the hotel */}
      {Number(order.delivery_fee) > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-slate-50 p-3 text-sm">
          <dt className="text-slate-600">Your delivery fee (keep)</dt>
          <dd className="text-right font-semibold">{inr(order.delivery_fee)}</dd>
          {Number(order.pay_vendor) > 0 && (
            <>
              <dt className="text-slate-600">Pay {order.shop_name ?? "hotel"}</dt>
              <dd className="text-right font-semibold">{inr(order.pay_vendor)}</dd>
            </>
          )}
          {order.vendor_id && (
            <p className="col-span-2 text-xs text-slate-500">
              {order.commission_free
                ? "No franchise commission on this order."
                : Number(order.vendor_commission) > 0
                  ? `Franchise commission ${inr(order.vendor_commission)} is settled by the hotel with the franchise, not by you.`
                  : null}
            </p>
          )}
        </dl>
      )}

      <RequestDetails order={order} />

      {order.customer_phone && (
        <a
          href={`tel:+91${order.customer_phone}`}
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-semibold"
        >
          <Phone className="h-4 w-4" /> Call {order.customer_phone}
        </a>
      )}

      {/* navigation aids saved from earlier deliveries */}
      {nav && (nav.turning_point || nav.voice_direction_url || nav.house_image_url || nav.rider_delivery_note) && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          {nav.is_location_verified && <p className="font-semibold text-green-700">✅ Verified Gate Location</p>}
          {nav.turning_point && <p>↪ {nav.turning_point}</p>}
          {nav.rider_delivery_note && <p>📝 {nav.rider_delivery_note}</p>}
          {nav.voice_direction_url && <audio controls preload="none" src={nav.voice_direction_url} className="w-full" />}
          {nav.house_image_url && <img src={nav.house_image_url} alt="House" className="max-h-40 rounded-lg" />}
        </div>
      )}

      {/* The server sends the Magic Link from the business number; the rider's own WhatsApp is only the fallback. */}
      {order.magic_link_sent_at ? (
        <div className="space-y-1.5">
          <p className="flex items-center justify-center gap-2 rounded-2xl bg-green-50 py-3 text-sm font-semibold text-green-800">
            <CheckCircle2 className="h-4 w-4" /> Magic Link sent to the customer
          </p>
          <button
            type="button"
            onClick={() => window.open(whatsappUrl(order), "_blank", "noopener")}
            className="w-full text-center text-xs font-semibold text-slate-500 underline"
          >
            Customer did not get it? Send again from my WhatsApp
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => window.open(whatsappUrl(order), "_blank", "noopener")}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] py-4 text-base font-bold text-white shadow active:scale-95"
        >
          <MessageCircle className="h-5 w-5" /> Send WhatsApp Magic Link
        </button>
      )}

      <RouteMap order={{ ...order, drop_lat: order.drop_lat, drop_lng: order.drop_lng }} riderPosition={riderPosition} />

      <p className={`flex items-center gap-1.5 text-xs ${tracking ? "text-green-700" : "text-slate-400"}`}>
        <Radio className="h-3.5 w-3.5" />
        {tracking
          ? `Live tracking on — sharing your position every 5 s${
              riderPosition?.accuracy ? ` (±${Math.round(riderPosition.accuracy)} m)` : ""
            }`
          : "Live tracking off"}
      </p>

      <button
        type="button"
        onClick={() => onDeliver(order)}
        className="w-full rounded-2xl bg-green-600 py-4 text-lg font-bold text-white shadow active:scale-95"
      >
        ✅ Mark as Delivered
      </button>
    </section>
  );
}

/** Rider corrects the payment method after pickup, before delivery (§19.1). */
function PaymentMethodModal({ order, onClose, onChanged }) {
  const [choice, setChoice] = useState(order.payment_method);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function save() {
    setBusy(true);
    setProblem("");
    try {
      const { data } = await api.patch(`/orders/${order.id}/payment-method`, { payment_method: choice });
      onChanged(data.data);
    } catch (error) {
      setProblem(getErrorMessage(error, "Could not change the payment method."));
      setBusy(false);
    }
  }

  return (
    <Modal title="Change payment method" onClose={busy ? () => {} : onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Only change this if you picked the wrong one. The amounts are worked out again.</p>
        <div className="grid gap-2">
          {Object.entries(PAYMENT_LABELS)
            .filter(([value]) => !value.startsWith("PREPAID") || order.vendor_id)
            .map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setChoice(value)}
                aria-pressed={choice === value}
                className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold ${
                  choice === value ? "border-orange-500 bg-orange-50 text-orange-800" : "border-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
        </div>
        {problem && <p role="alert" className="text-sm font-semibold text-red-600">{problem}</p>}
        <button
          type="button"
          disabled={busy || choice === order.payment_method}
          onClick={save}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-bold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </Modal>
  );
}
