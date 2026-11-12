import { MessageCircle, Phone, Radio } from "lucide-react";
import StatusBadge from "../StatusBadge.jsx";
import { PAYMENT_LABELS, inr } from "../../utils/format.js";
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

export default function ActiveDeliveryCard({ order, riderPosition, tracking, onDeliver }) {
  const nav = order.navigation;
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
          </p>
        </div>
        <StatusBadge status={order.order_status} />
      </div>

      {/* money to collect */}
      <div className="rounded-xl bg-orange-50 p-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">
          Collect from customer
        </p>
        <p className="text-3xl font-extrabold text-orange-700">{inr(order.amount_to_collect)}</p>
        <p className="text-xs text-slate-600">{PAYMENT_LABELS[order.payment_method]}</p>
      </div>

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

      <button
        type="button"
        onClick={() => window.open(whatsappUrl(order), "_blank", "noopener")}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] py-4 text-base font-bold text-white shadow active:scale-95"
      >
        <MessageCircle className="h-5 w-5" /> Send WhatsApp Magic Link
      </button>

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
