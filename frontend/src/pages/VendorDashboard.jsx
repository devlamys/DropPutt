import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, LogOut, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import Modal from "../components/Modal.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSocket } from "../hooks/useSocket.js";
import api, { getErrorMessage, idempotencyHeaders } from "../utils/api.js";
import { inr, minutesAgo } from "../utils/format.js";

const EVENTS = ["order_accepted", "order_picked_up", "order_delivered", "order_status_changed"];

export default function VendorDashboard() {
  const { user, signOut } = useAuth();
  const { toast, node: toastNode } = useToast();

  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);
  const [billPreview, setBillPreview] = useState(null);
  const [now, setNow] = useState(Date.now());
  const callLock = useRef(false); // state updates are async; this blocks a same-tick double tap

  const loadOrders = useCallback(async () => {
    try {
      const { data } = await api.get("/orders/active");
      setOrders(data.data.orders);
    } catch (error) {
      toast(getErrorMessage(error), "error");
    }
  }, [toast]);

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
  const { connected } = useSocket(
    Object.fromEntries(
      EVENTS.map((event) => [
        event,
        () => {
          refresh();
          if (event === "order_picked_up") toast("🛵 Rider picked up an order", "success");
        },
      ])
    )
  );
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [refresh]);

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
                    <div>
                      <StatusBadge status={order.order_status} />
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
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Menu availability */}
        <section aria-labelledby="menu-heading">
          <h2 id="menu-heading" className="mb-2 text-base font-bold">
            Menu availability
          </h2>
          {products.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
              No menu items yet.
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
                      {inr(product.price)}
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
