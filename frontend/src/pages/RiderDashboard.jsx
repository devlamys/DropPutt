import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import ActiveDeliveryCard from "../components/rider/ActiveDeliveryCard.jsx";
import AlarmModal from "../components/rider/AlarmModal.jsx";
import DeliveredModal from "../components/rider/DeliveredModal.jsx";
import PickupForm from "../components/rider/PickupForm.jsx";
import RiderTopBar from "../components/rider/RiderTopBar.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useRiderTracking } from "../hooks/useRiderTracking.js";
import { useSocket } from "../hooks/useSocket.js";
import api, { getErrorMessage } from "../utils/api.js";
import { startAlarm, stopAlarm, unlockAlarm } from "../utils/alarm.js";
import { inr } from "../utils/format.js";

export default function RiderDashboard() {
  const { user, signOut } = useAuth();
  const { toast, node: toastNode } = useToast();

  const [status, setStatus] = useState(null);
  const [orders, setOrders] = useState([]);
  const [zones, setZones] = useState([]);
  const [queue, setQueue] = useState([]); // pending alarm requests
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [delivering, setDelivering] = useState(null);

  const online = Boolean(status?.rider.is_online);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const loadStatus = useCallback(async () => {
    const { data } = await api.get("/rider/me");
    setStatus(data.data);
    return data.data;
  }, []);

  const enqueue = useCallback((request) => {
    setQueue((list) =>
      list.some((r) => r.order_id === request.order_id) ? list : [...list, request]
    );
  }, []);

  const loadOrders = useCallback(async () => {
    const { data } = await api.get("/orders/active");
    setOrders(data.data.orders);
    // Requests that arrived while the app was closed or offline.
    for (const request of data.data.open_requests) enqueue({ ...request, kind: "new" });
    // Anything no longer open drops out of the queue.
    const open = new Set(data.data.open_requests.map((r) => r.order_id));
    setQueue((list) => list.filter((r) => r.kind === "addon" || open.has(r.order_id)));
  }, [enqueue]);

  const reloadAll = useCallback(async () => {
    try {
      await Promise.all([loadStatus(), loadOrders()]);
    } catch (error) {
      toast(getErrorMessage(error), "error");
    }
  }, [loadStatus, loadOrders, toast]);

  useEffect(() => {
    Promise.all([reloadAll(), api.get("/orders/zones").then(({ data }) => setZones(data.data.zones))])
      .catch((error) => toast(getErrorMessage(error), "error"))
      .finally(() => setLoading(false));
  }, [reloadAll, toast]);

  const { socket, connected } = useSocket({
    new_rider_request: (payload) => {
      if (onlineRef.current) enqueue({ ...payload, kind: "new" });
    },
    addon_order_alert: (payload) => {
      if (onlineRef.current) enqueue({ ...payload, kind: "addon" });
    },
    order_taken: ({ order_id }) => setQueue((list) => list.filter((r) => r.order_id !== order_id)),
    customer_location_shared: () => {
      toast("📍 Customer shared their location", "success");
      loadOrders().catch(() => {});
    },
    tip_added: () => {
      toast("💚 Customer added a tip!", "success");
      loadOrders().catch(() => {});
    },
    milestone_achieved: ({ bonus, target }) => {
      toast(`🎉 ${target} deliveries done — ${inr(bonus)} bonus earned!`, "success");
      loadStatus().catch(() => {});
    },
  });

  // Reconnect catch-up: sockets miss events while offline.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connected && wasConnected.current) reloadAll();
    wasConnected.current = connected;
  }, [connected, reloadAll]);

  // The alarm loops for as long as a request is waiting.
  useEffect(() => {
    if (queue.length > 0) startAlarm();
    else stopAlarm();
    return stopAlarm;
  }, [queue.length]);

  const { position, tracking, error: trackingError } = useRiderTracking({ socket, orders });

  async function toggleOnline() {
    unlockAlarm(); // this tap is the gesture that lets the alarm make sound
    setToggling(true);
    try {
      const { data } = await api.patch("/rider/me/online", { is_online: !online });
      setStatus(data.data);
      if (!data.data.rider.is_online) setQueue([]);
      else await loadOrders();
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setToggling(false);
    }
  }

  async function acceptRequest(request) {
    try {
      await api.post(`/orders/${request.order_id}/accept`);
      setQueue((list) => list.filter((r) => r.order_id !== request.order_id));
      toast("Order accepted — go pick it up!", "success");
      await Promise.all([loadOrders(), loadStatus()]);
    } catch (error) {
      setQueue((list) => list.filter((r) => r.order_id !== request.order_id));
      toast(getErrorMessage(error, "Could not accept this order."), "error");
    }
  }

  const dismissRequest = (request) =>
    setQueue((list) => list.filter((r) => r.order_id !== request.order_id));

  const toPickup = orders.filter((o) => o.order_status === "RIDER_ASSIGNED");
  const inDelivery = orders.filter((o) => ["PICKED_UP", "LOCATION_SHARED"].includes(o.order_status));

  return (
    <div className="mx-auto min-h-screen max-w-lg pb-16">
      {toastNode}
      <RiderTopBar
        name={user.name}
        status={status}
        connected={connected}
        toggling={toggling}
        onToggleOnline={toggleOnline}
        onSignOut={signOut}
      />

      <main className="space-y-5 px-4 pt-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {trackingError && tracking && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{trackingError}</p>
            )}

            {toPickup.map((order) => (
              <PickupForm
                key={order.id}
                order={order}
                zones={zones}
                onError={(message) => toast(message, "error")}
                onPickedUp={() => {
                  toast("Pickup saved. Send the Magic Link to the customer.", "success");
                  reloadAll();
                }}
              />
            ))}

            {inDelivery.map((order) => (
              <ActiveDeliveryCard
                key={order.id}
                order={order}
                riderPosition={position}
                tracking={tracking}
                onDeliver={setDelivering}
              />
            ))}

            {toPickup.length === 0 && inDelivery.length === 0 && (
              <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
                <p className="text-4xl">{online ? "🛵" : "😴"}</p>
                <p className="mt-2 font-semibold">
                  {online ? "Waiting for orders…" : "You are offline"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {online
                    ? "Keep this screen open. A loud alert plays when an order arrives."
                    : "Switch to Online to start receiving orders."}
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {queue.length > 0 && (
        <AlarmModal
          request={queue[0]}
          queued={queue.length - 1}
          onAccept={acceptRequest}
          onDismiss={dismissRequest}
        />
      )}

      {delivering && (
        <DeliveredModal
          order={delivering}
          onClose={() => setDelivering(null)}
          onDelivered={({ settlement, already_delivered }) => {
            setDelivering(null);
            const cash = settlement?.cash_collected;
            toast(
              already_delivered
                ? "Already marked delivered."
                : `Delivered ✅${cash ? ` Cash collected ${inr(cash)}` : ""}`,
              "success"
            );
            reloadAll();
          }}
        />
      )}
    </div>
  );
}
