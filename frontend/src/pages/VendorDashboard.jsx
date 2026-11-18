import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, History, Loader2, LogOut, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import CancelOrderModal from "../components/CancelOrderModal.jsx";
import Modal from "../components/Modal.jsx";
import CashHandoverCard from "../components/vendor/CashHandoverCard.jsx";
import AlertsPrompt from "../components/AlertsPrompt.jsx";
import OrderItemList from "../components/OrderItemList.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAlarmBlocked } from "../hooks/useAlarmBlocked.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useSocket } from "../hooks/useSocket.js";
import api, { getErrorMessage, idempotencyHeaders } from "../utils/api.js";
import { startAlarm, stopAlarm } from "../utils/alarm.js";
import { clockTime, inr, minutesAgo, minutesUntil } from "../utils/format.js";

const EVENTS = ["new_order_for_vendor", "order_seen", "order_prep_time", "order_accepted", "order_picked_up", "order_delivered", "order_status_changed", "order_cancelled", "order_payment_changed"];
// A new customer order rings until the shop taps "Got it". The tap is saved on
// the order (vendor_seen_at), so every phone of the shop stops ringing together.
const ALERT_STATUSES = ["RIDER_REQUESTED", "RIDER_ASSIGNED"];

/** Where the rider stands, in words the shop can act on. */
function RiderLine({ order }) {
  if (order.order_status === "RIDER_REQUESTED") {
    return <p className="text-sm font-semibold text-amber-700">⏳ Waiting for a rider to accept…</p>;
  }
  if (order.order_status === "RIDER_ASSIGNED" && order.rider) {
    return (
      <p className="text-sm font-semibold text-green-700">
        🛵 Rider on the way — {order.rider.name}
        {order.rider.vehicle_number ? ` · ${order.rider.vehicle_number}` : ""}. Keep the food ready!
      </p>
    );
  }
  if (["PICKED_UP", "LOCATION_SHARED"].includes(order.order_status)) {
    return (
      <p className="text-sm font-semibold text-violet-700">
        ✅ Picked up{order.rider ? ` by ${order.rider.name}` : ""} — on the way to the customer
      </p>
    );
  }
  return null;
}

const PREP_CHOICES = [[10, "10 min"], [15, "15 min"], [20, "20 min"], [30, "30 min"], [45, "45 min"], [0, "Ready now"]];

/** The shop tells the customer and the rider how long the food will take. */
function PrepTime({ order, now, onSet }) {
  const left = minutesUntil(order.prep_ready_at, now);
  return (
    <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
      <p className="text-sm font-bold text-amber-900">
        🍳 {order.prep_ready_at ? (left > 0 ? `Ready in ${left} min · by ${clockTime(order.prep_ready_at)}` : "Marked ready") : "How long will it take?"}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PREP_CHOICES.map(([minutes, label]) => (
          <button key={minutes} type="button" onClick={() => onSet(order, minutes)} className="min-h-10 rounded-full bg-white px-3.5 text-sm font-bold text-amber-900 ring-1 ring-amber-300 active:scale-95">
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// A shop can withdraw an order until the rider has the food in hand.
const SHOP_CAN_CANCEL = ["RIDER_REQUESTED", "RIDER_ASSIGNED"];

export default function VendorDashboard() {
  const { user, signOut } = useAuth();
  const { toast, node: toastNode } = useToast();

  const [cashTick, setCashTick] = useState(0); // bumps when a cash event arrives
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [billPreview, setBillPreview] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [acked, setAcked] = useState(() => new Set()); // taps not yet confirmed by the server
  const { blocked: soundBlocked, unlock: unlockSound } = useAlarmBlocked();
  const callLock = useRef(false); // state updates are async; this blocks a same-tick double tap

  const loadOrders = useCallback(async () => {
    try {
      const { data } = await api.get("/orders/active");
      setOrders(data.data.orders);
    } catch (error) {
      toast(getErrorMessage(error), "error");
    }
  }, [toast]);

  // Customer orders the shop has not yet looked at: the loud alert stays on until they do.
  const alerts = orders.filter(
    (o) =>
      o.order_type === "FOOD_MARKETPLACE" &&
      ALERT_STATUSES.includes(o.order_status) &&
      !o.vendor_seen_at &&
      !acked.has(o.id)
  );
  async function setPrep(order, minutes) {
    try {
      const { data } = await api.post(`/orders/${order.id}/prep-time`, { minutes });
      setOrders((list) => list.map((o) => (o.id === order.id ? { ...o, prep_ready_at: data.data.prep_ready_at } : o)));
      toast(minutes === 0 ? "Marked ready. The customer and rider can see it." : `Told the customer: ready in ${minutes} min.`, "success");
    } catch (error) {
      toast(getErrorMessage(error, "Could not save. Try again."), "error");
    }
  }
  async function acknowledge(order) {
    setAcked((current) => new Set(current).add(order.id)); // stop the alert at once
    try {
      await api.post(`/orders/${order.id}/vendor-seen`);
    } catch (error) {
      // Not saved: bring the alert back rather than silently losing a new order.
      setAcked((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
      toast(getErrorMessage(error, "Could not save. Try again."), "error");
    }
  }
  useEffect(() => {
    if (alerts.length > 0) startAlarm("vendor");
    else stopAlarm();
    return stopAlarm;
  }, [alerts.length]);

  const loadShop = useCallback(async () => {
    try {
      const { data } = await api.get("/vendor/me");
      setShop(data.data.shop);
      setProducts(data.data.products);
    } catch (error) {
      toast(getErrorMessage(error), "error");
    }
  }, [toast]);

  useEffect(() => {
    Promise.all([loadShop(), loadOrders()]).finally(() => setLoading(false));
  }, [loadShop, loadOrders]);

  // Live updates over the socket; polling is the safety net.
  const refresh = useCallback(() => void loadOrders(), [loadOrders]);
  const { connected } = useSocket({
    ...Object.fromEntries(
      EVENTS.map((event) => [
        event,
        () => {
          refresh();
          // A new order takes stock and a cancelled one gives it back: keep the menu counts live.
          if (["order_status_changed", "order_cancelled", "new_order_for_vendor"].includes(event)) void loadShop();
          if (event === "order_accepted") toast("🛵 A rider accepted your order — keep it ready!", "success");
          if (event === "order_picked_up") toast("🛵 Rider picked up an order", "success");
          if (event === "order_cancelled") toast("An order was cancelled", "warn");
        },
      ])
    ),
    cash_handover_requested: ({ rider_name, amount }) => {
      toast(`💵 ${rider_name} says they paid ${inr(amount)} — please confirm`, "info");
      setCashTick((n) => n + 1);
    },
    cash_handover_resolved: () => setCashTick((n) => n + 1),
  });
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") {
        refresh();
        void loadShop();
      }
    }, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [refresh, loadShop]);

  async function callRider() {
    if (callLock.current) return;
    callLock.current = true;
    setCalling(true);
    try {
      const { data } = await api.post("/orders/quick-call", {}, { headers: idempotencyHeaders() });
      const { order, dispatch } = data.data;
      if (dispatch.requested + dispatch.addon === 0) {
        toast(`Order ${order.order_number} created, but no rider is online right now.`, "warn");
      } else {
        toast(`Order ${order.order_number}: alerting ${dispatch.requested + dispatch.addon} rider(s)…`, "success");
      }
      await loadOrders();
    } catch (error) {
      toast(getErrorMessage(error, "Could not call a rider."), "error");
    } finally {
      // Short lock so a double tap cannot create two orders.
      setTimeout(() => {
        callLock.current = false;
        setCalling(false);
      }, 2500);
    }
  }

  async function toggleProduct(product) {
    const next = !product.is_available;
    setProducts((list) => list.map((p) => (p.id === product.id ? { ...p, is_available: next } : p)));
    try {
      await api.patch(`/vendor/products/${product.id}`, { is_available: next });
    } catch (error) {
      setProducts((list) =>
        list.map((p) => (p.id === product.id ? { ...p, is_available: !next } : p))
      );
      toast(getErrorMessage(error), "error");
    }
  }

  async function toggleShop() {
    const next = !shop.is_open;
    setShop({ ...shop, is_open: next });
    try {
      await api.patch("/vendor/shop", { is_open: next });
    } catch (error) {
      setShop({ ...shop, is_open: !next });
      toast(getErrorMessage(error), "error");
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-3xl pb-10">
      {toastNode}

      <AlertsPrompt />
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">{shop?.shop_name ?? user.name}</h1>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            {connected ? (
              <Wifi className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-red-500" />
            )}
            {connected ? "Live" : "Reconnecting…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {shop && (
            <button
              type="button"
              onClick={toggleShop}
              aria-pressed={shop.is_open}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                shop.is_open ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-600"
              }`}
            >
              {shop.is_open ? "● Shop open" : "○ Shop closed"}
            </button>
          )}
          <Link
            to="/vendor/history"
            aria-label="Orders and payments"
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
          >
            <History className="h-5 w-5" />
          </Link>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {shop?.trial_active && shop.commission_free_until && (
        <p className="mx-4 mt-4 rounded-2xl bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200">
          🎁 “Call Rider Now” has no commission for you until{" "}
          <strong>{new Date(new Date(shop.commission_free_until).getTime() - 1).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong>.
        </p>
      )}

      <CashHandoverCard reloadKey={cashTick} toast={toast} />

      <main className="space-y-6 px-4 pt-5">
        {/* One-tap rider call */}
        <section className="flex flex-col items-center py-2">
          <div className="relative w-full">
            <button
              type="button"
              onClick={callRider}
              disabled={calling || shop?.is_open === false}
              className={`relative flex min-h-[9rem] w-full flex-col items-center justify-center gap-1 rounded-3xl bg-gradient-to-br from-orange-500 to-red-600 px-4 py-6 text-center text-white shadow-xl transition active:scale-95 disabled:opacity-60 ${calling ? "" : "animate-ring-pulse"}`}
            >
              {calling ? (
                <Loader2 className="h-10 w-10 animate-spin" />
              ) : (
                <span className="text-3xl font-extrabold leading-tight sm:text-4xl">
                  🛵 Call Rider Now
                </span>
              )}
              <span className="text-base font-semibold opacity-90">(1-Click)</span>
            </button>
          </div>
          {shop?.is_open === false && (
            <p className="mt-2 text-sm text-slate-500">Open your shop to call a rider.</p>
          )}
        </section>

        {/* Active orders */}
        <section aria-labelledby="orders-heading">
          <h2 id="orders-heading" className="mb-2 text-base font-bold">
            Active orders {orders.length > 0 && <span className="text-slate-400">({orders.length})</span>}
          </h2>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : orders.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
              No active orders. Tap the big button when you need a rider.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              <div className="hidden grid-cols-[1.2fr_1.6fr_1fr_1fr] gap-3 border-b bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
                <span>Order</span>
                <span>Status</span>
                <span>Rider</span>
                <span>Bill check</span>
              </div>
              <ul className="divide-y">
                {orders.map((order) => (
                  <li
                    key={order.id}
                    className="grid gap-2 px-4 py-3 md:grid-cols-[1.2fr_1.6fr_1fr_1fr] md:items-center md:gap-3"
                  >
                    <div>
                      <p className="font-semibold">#{order.order_number}</p>
                      <p className="text-xs text-slate-500">{minutesAgo(order.created_at, now)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={order.order_status} />
                      {order.channel === "WHATSAPP" && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">WhatsApp</span>
                      )}
                      {Number(order.collect_from_hotel) > 0 && (
                        <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800">
                          Give the rider {inr(order.collect_from_hotel)} delivery fee
                        </span>
                      )}
                      {SHOP_CAN_CANCEL.includes(order.order_status) && (
                        <button
                          type="button"
                          onClick={() => setCancelling(order)}
                          className="rounded-full px-2.5 py-1 text-xs font-bold text-red-600 ring-1 ring-red-200 hover:bg-red-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <div className="text-sm">
                      {order.rider ? (
                        <>
                          <p className="font-medium">{order.rider.name}</p>
                          <p className="text-xs text-slate-500">{order.rider.vehicle_number}</p>
                        </>
                      ) : (
                        <span className="text-slate-400">Waiting for a rider…</span>
                      )}
                    </div>
                    <BillCheck order={order} onPreview={setBillPreview} />
                    {(order.items?.length > 0 || ALERT_STATUSES.includes(order.order_status)) && (
                      <div className="space-y-2 md:col-span-4">
                        <RiderLine order={order} />
                        {SHOP_CAN_CANCEL.includes(order.order_status) && order.order_type !== "CUSTOM_BUY" && <PrepTime order={order} now={now} onSet={setPrep} />}
                        <OrderItemList items={order.items} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Menu availability */}
        <section aria-labelledby="menu-heading">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="menu-heading" className="text-base font-bold">
              Menu availability
            </h2>
            <Link to="/vendor/menu" className="rounded-full bg-green-600 px-3 py-1.5 text-xs font-bold text-white">
              Manage menu
            </Link>
          </div>
          {products.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
              No menu items yet. Use “Manage menu” to add your dishes.
            </p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
              {products.map((product) => (
                <li key={product.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className={`truncate font-medium ${product.is_available ? "" : "text-slate-400 line-through"}`}>
                      {product.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {product.offer_active ? `${inr(product.effective_price)} (offer)` : inr(product.price)}
                      {product.stock_qty != null && ` · ${product.stock_qty === 0 ? "sold out" : `${product.stock_qty} left`}`}
                      {product.is_combo && " · Combo"}
                      {product.slot_type !== "ALL_DAY" && ` · ${product.slot_type.replaceAll("_", " ").toLowerCase()}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={product.is_available}
                    aria-label={`${product.name} available`}
                    onClick={() => toggleProduct(product)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                      product.is_available ? "bg-green-500" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                        product.is_available ? "left-[1.375rem]" : "left-0.5"
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {cancelling && (
        <CancelOrderModal
          order={cancelling}
          role="VENDOR"
          toast={toast}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            loadOrders();
          }}
        />
      )}

      {alerts.length > 0 && (
        <Modal title="🔔 New order!" tone="alert" dismissible={false}>
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-2xl bg-orange-50 p-4">
              <BellRing className="h-8 w-8 shrink-0 animate-bounce text-orange-600" />
              <div className="min-w-0 text-sm">
                <p className="text-base font-bold">Order #{alerts[0].order_number}</p>
                <RiderLine order={alerts[0]} />
              </div>
            </div>
            {soundBlocked && (
              <button
                type="button"
                onClick={unlockSound}
                className="w-full rounded-2xl bg-orange-600 py-3 text-base font-bold text-white shadow active:scale-95"
              >
                🔊 Tap here to turn the alert sound on
              </button>
            )}
            <OrderItemList items={alerts[0].items} big title="Prepare" />
            {alerts.length > 1 && <p className="text-center text-xs text-slate-500">+{alerts.length - 1} more waiting</p>}
            <button
              type="button"
              onClick={() => acknowledge(alerts[0])}
              className="w-full rounded-2xl bg-green-600 py-4 text-lg font-bold text-white shadow active:scale-95"
            >
              Got it
            </button>
          </div>
        </Modal>
      )}

      {billPreview && (
        <Modal title={`Bill · #${billPreview.order_number}`} onClose={() => setBillPreview(null)}>
          <p className="mb-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Rider entered <strong>{inr(billPreview.item_total)}</strong>. Check it matches this photo.
          </p>
          <img
            src={billPreview.bill_image_url}
            alt="Bill photo"
            className="w-full rounded-xl border"
          />
        </Modal>
      )}
    </div>
  );
}

/** Anti-fraud: the amount the rider typed next to the photo they took. */
function BillCheck({ order, onPreview }) {
  const shown = ["PICKED_UP", "LOCATION_SHARED"].includes(order.order_status);
  if (!shown) return <span className="text-xs text-slate-400">After pickup</span>;
  return (
    <div className="flex items-center gap-3">
      <div>
        <p className="text-xs text-slate-500">Bill amount</p>
        <p className="text-lg font-bold">{inr(order.item_total)}</p>
      </div>
      {order.bill_image_url ? (
        <button
          type="button"
          onClick={() => onPreview(order)}
          className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-slate-100"
          aria-label="Preview bill photo"
        >
          <img src={order.bill_image_url} alt="" className="h-full w-full object-cover" />
        </button>
      ) : (
        <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
          <ShieldAlert className="h-4 w-4" /> No photo
        </span>
      )}
    </div>
  );
}
