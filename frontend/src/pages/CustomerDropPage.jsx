import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import LiveTrackingMap from "../components/customer/LiveTrackingMap.jsx";
import VoiceRecorder from "../components/customer/VoiceRecorder.jsx";
import { useToast } from "../components/Toast.jsx";
import api, { MULTIPART, SOCKET_PATH, SOCKET_URL, getErrorMessage } from "../utils/api.js";
import { inr } from "../utils/format.js";

// SPEC §21 — exact wording (the server sends the same text).
const INDOOR_GPS_WARNING_ML =
  "ലൊക്കേഷൻ കൃത്യത കുറവാണ് (Indoor GPS). ദയവായി മുറ്റത്തോ വരാന്തയിലോ ഇറങ്ങി നിന്ന് അമർത്തുക, അല്ലെങ്കിൽ താഴെ കാണുന്ന മൈക്കിൽ വഴി റെക്കോർഡ് ചെയ്യുക.";
const GPS_LIMIT_M = 50;
const ACTIVE = ["RIDER_ASSIGNED", "PICKED_UP", "LOCATION_SHARED"];
const STEPS = [
  { status: "RIDER_REQUESTED", label: "Order placed" },
  { status: "RIDER_ASSIGNED", label: "Rider at shop" },
  { status: "PICKED_UP", label: "On the way" },
  { status: "DELIVERED", label: "Delivered" },
];
const VEHICLE = { BIKE: "Bike", SCOOTER: "Scooter", AUTO: "Auto", MINI_TRUCK: "Mini truck" };

const publicApi = (config = {}) => ({ ...config, skipAuth: true });
const point = (lat, lng) =>
  lat != null && lng != null ? [Number(lat), Number(lng)] : null;

function stepIndex(status) {
  if (status === "LOCATION_SHARED") return 2;
  return Math.max(0, STEPS.findIndex((s) => s.status === status));
}

export default function CustomerDropPage() {
  const { token } = useParams();
  const { toast, node: toastNode } = useToast();
  const [order, setOrder] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [bike, setBike] = useState(null);
  const [connected, setConnected] = useState(false);

  const [turningPoint, setTurningPoint] = useState("");
  const [voice, setVoice] = useState(null);
  const [fix, setFix] = useState(null); // last GPS reading
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState(null);
  const [tipping, setTipping] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/public/drop/${token}`, publicApi());
      setOrder(data.data);
      setTurningPoint((current) => current || data.data.turning_point || "");
      const position = point(data.data.rider_lat, data.data.rider_lng);
      if (position) setBike((current) => current || position);
      setLoadError("");
    } catch (error) {
      setLoadError(
        error?.response?.status === 404
          ? "This tracking link is not valid. Please check the link from your rider."
          : getErrorMessage(error)
      );
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Live tracking room for this order — authorised by the Magic Link token.
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      auth: { location_token: token },
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("live_bike_position", ({ lat, lng }) => setBike([lat, lng]));
    socket.on("order_status_changed", () => load());
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [token, load]);

  // REST fallback when the socket is down; also refreshes amounts.
  const statusRef = useRef(null);
  statusRef.current = order?.order_status;
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      if (statusRef.current === "DELIVERED" || statusRef.current === "CANCELLED") return;
      if (!connected) {
        try {
          const { data } = await api.get(`/public/drop/${token}/status`, publicApi());
          const position = point(data.data.rider_lat, data.data.rider_lng);
          if (position) setBike(position);
          if (data.data.order_status !== statusRef.current) load();
        } catch {
          /* keep showing the last state */
        }
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [connected, token, load]);

  const home = useMemo(() => (order ? point(order.drop_lat, order.drop_lng) : null), [order]);

  const submitLocation = useCallback(
    async (reading) => {
      const form = new FormData();
      form.append("lat", String(reading.lat));
      form.append("lng", String(reading.lng));
      form.append("gps_accuracy", String(Math.round(reading.accuracy * 100) / 100));
      if (turningPoint.trim()) form.append("turning_point", turningPoint.trim());
      if (voice) {
        const ext = voice.type.includes("mp4") ? "m4a" : voice.type.includes("ogg") ? "ogg" : "webm";
        form.append("voice", voice, `route.${ext}`);
      }
      const { data } = await api.post(`/public/drop/${token}/voice-and-pin`, form, publicApi(MULTIPART));
      setShareResult(data.data);
      if (data.data.saved) {
        toast("📍 Location sent to your rider. Thank you!", "success");
        await load();
      }
    },
    [token, turningPoint, voice, load, toast]
  );

  function shareLocation() {
    if (!("geolocation" in navigator)) {
      toast("This phone cannot share location. Please record voice directions.", "error");
      return;
    }
    setSharing(true);
    setShareResult(null);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const reading = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
        setFix(reading);
        try {
          await submitLocation(reading);
        } catch (error) {
          toast(getErrorMessage(error, "Could not send your location."), "error");
        } finally {
          setSharing(false);
        }
      },
      (error) => {
        setSharing(false);
        toast(
          error.code === 1
            ? "Please allow location access, then press the button again."
            : "Could not get your location. Step outside and try again.",
          "error"
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  async function resendWithVoice() {
    if (!fix) return shareLocation();
    setSharing(true);
    try {
      await submitLocation(fix);
    } catch (error) {
      toast(getErrorMessage(error, "Could not send your directions."), "error");
    } finally {
      setSharing(false);
    }
  }

  async function addTip(amount) {
    const actionId = crypto.randomUUID(); // one tap = one tip, even if retried
    setTipping(amount);
    try {
      const { data } = await api.post(
        `/public/drop/${token}/tip`,
        { tip: amount, client_action_id: actionId },
        publicApi({ headers: { "Idempotency-Key": actionId } })
      );
      setOrder((current) => ({ ...current, ...data.data }));
      toast(`💚 ₹${amount} tip added for your rider. Thank you!`, "success");
    } catch (error) {
      toast(getErrorMessage(error, "Could not add the tip."), "error");
    } finally {
      setTipping(null);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-4xl">🔗</p>
        <p className="font-semibold">{loadError}</p>
      </main>
    );
  }
  if (!order) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </main>
    );
  }

  const active = ACTIVE.includes(order.order_status);
  const delivered = order.order_status === "DELIVERED";
  const cancelled = order.order_status === "CANCELLED";
  const billReady = Number(order.grand_total) > 0;
  const current = stepIndex(order.order_status);
  const weakGps =
    shareResult?.gps_accuracy_poor || (fix && fix.accuracy > GPS_LIMIT_M && !shareResult?.saved);
  const warningText = shareResult?.warning?.message || INDOOR_GPS_WARNING_ML;

  return (
    <div className="mx-auto min-h-screen max-w-md pb-12">
      {toastNode}
      <header className="bg-gradient-to-br from-orange-500 to-red-600 px-4 pb-6 pt-5 text-white">
        <p className="text-sm opacity-90">Order #{order.order_number}</p>
        <h1 className="text-2xl font-extrabold">{order.shop_name ?? "Your delivery"}</h1>
        <p className="mt-1 font-medium">{order.estimated_message}</p>
        {order.rider && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">
            🛵 {order.rider.first_name} · {VEHICLE[order.rider.vehicle_type] ?? order.rider.vehicle_type}
          </p>
        )}
      </header>

      <main className="-mt-3 space-y-4 px-4">
        {/* progress */}
        <ol className="grid grid-cols-4 gap-1 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          {STEPS.map((step, i) => (
            <li key={step.status} className="text-center">
              <div
                className={`mx-auto mb-1 h-2 rounded-full ${
                  cancelled ? "bg-slate-200" : i <= current ? "bg-orange-500" : "bg-slate-200"
                }`}
              />
              <span className={`text-[11px] ${i <= current ? "font-semibold text-slate-900" : "text-slate-400"}`}>
                {step.label}
              </span>
            </li>
          ))}
        </ol>

        {delivered && (
          <div className="flex items-center gap-3 rounded-2xl bg-green-50 p-4 text-green-800 ring-1 ring-green-200">
            <CheckCircle2 className="h-8 w-8 shrink-0" />
            <p className="font-semibold">Delivered. Thank you for ordering! 🙏</p>
          </div>
        )}
        {cancelled && (
          <p className="rounded-2xl bg-slate-100 p-4 text-center font-semibold text-slate-600">This order was cancelled.</p>
        )}

        {/* share location */}
        {active && (
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <button
              type="button"
              onClick={shareLocation}
              disabled={sharing}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-700 px-4 py-6 text-center text-white shadow-lg transition active:scale-95 disabled:opacity-70"
            >
              {sharing ? <Loader2 className="h-8 w-8 animate-spin" /> : <MapPin className="h-8 w-8" />}
              <span className="text-2xl font-extrabold">📍 Share My Current Location</span>
              <span className="text-sm opacity-90">Stand at your gate for the best accuracy</span>
            </button>

            {fix && (
              <p
                className={`rounded-xl px-3 py-2 text-center text-sm font-semibold ${
                  fix.accuracy <= GPS_LIMIT_M ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
                }`}
              >
                GPS accuracy: ±{Math.round(fix.accuracy)} m {fix.accuracy <= GPS_LIMIT_M ? "— good" : "— weak"}
              </p>
            )}

            {weakGps && (
              <p role="alert" lang="ml" className="rounded-xl bg-amber-100 p-3 text-base font-semibold leading-relaxed text-amber-900">
                ⚠️ {warningText}
              </p>
            )}

            {shareResult?.saved && (
              <p className="rounded-xl bg-green-50 px-3 py-2 text-center text-sm font-semibold text-green-800">
                ✅ Your rider has your location{shareResult.has_voice_note ? " and voice directions" : ""}.
              </p>
            )}
          </section>
        )}

        {/* voice + landmark */}
        {active && (
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-bold">Help the rider find your house</h2>
            <div>
              <label htmlFor="turning-point" className="mb-1 block text-sm font-semibold">
                Turning point / landmark
              </label>
              <input
                id="turning-point"
                type="text"
                maxLength={300}
                placeholder="e.g. Turn left after the mosque, 2nd blue gate"
                value={turningPoint}
                onChange={(e) => setTurningPoint(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
              />
            </div>
            <VoiceRecorder value={voice} onChange={setVoice} disabled={sharing} />
            {(voice || turningPoint.trim()) && (
              <button
                type="button"
                onClick={resendWithVoice}
                disabled={sharing}
                className="w-full rounded-2xl bg-slate-900 py-3.5 font-bold text-white disabled:opacity-60"
              >
                {fix ? "Send directions to rider" : "Share location with these directions"}
              </button>
            )}
          </section>
        )}

        {/* live map */}
        {(active || delivered) && (
          <section className="space-y-2">
            <LiveTrackingMap home={home} bike={active ? bike : null} />
            <p className="text-center text-xs text-slate-500">
              {active
                ? bike
                  ? connected
                    ? "🟢 Live — rider position updates every few seconds"
                    : "Reconnecting to live tracking…"
                  : "The rider's position will appear once they start the delivery."
                : "Delivery complete."}
            </p>
          </section>
        )}

        {/* tip */}
        {order.can_tip && (
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-1 font-bold">🌧️🌙 Add Tip for Rider</h2>
            <p className="mb-3 text-sm text-slate-500">100% goes to your rider. Pay it together with your bill.</p>
            <div className="grid grid-cols-3 gap-2">
              {(order.tip_options ?? [10, 20, 30]).map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => addTip(amount)}
                  disabled={tipping !== null}
                  className="flex items-center justify-center gap-1 rounded-2xl border-2 border-orange-300 bg-orange-50 py-4 text-lg font-extrabold text-orange-700 active:scale-95 disabled:opacity-60"
                >
                  {tipping === amount ? <Loader2 className="h-5 w-5 animate-spin" /> : `+₹${amount}`}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* bill */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 font-bold">Bill</h2>
          {billReady ? (
            <>
              <dl className="space-y-1.5 text-sm">
                <Row label="Items (shop bill)" value={inr(order.item_total)} />
                <Row label="Delivery fee" value={inr(order.delivery_fee)} />
                {Number(order.rider_tip) > 0 && <Row label="Rider tip" value={inr(order.rider_tip)} />}
                {Number(order.discount_amount) > 0 && <Row label="Discount" value={`− ${inr(order.discount_amount)}`} />}
                <div className="my-2 border-t" />
                <Row label="Total" value={inr(order.grand_total)} strong />
              </dl>
              <p className="mt-3 rounded-xl bg-orange-50 p-3 text-center text-sm font-semibold text-orange-800">
                {order.payment_method === "COD" && `Pay the rider ${inr(order.amount_to_collect)} in cash`}
                {order.payment_method === "PREPAID_AT_HOTEL" &&
                  `Food already paid at the shop. Pay the rider ${inr(order.amount_to_collect)} (delivery${Number(order.rider_tip) > 0 ? " + tip" : ""}).`}
                {order.payment_method === "UPI_TO_ADMIN" &&
                  (Number(order.amount_to_collect) > 0
                    ? `Paid online. Pay the rider ${inr(order.amount_to_collect)}.`
                    : "Paid online. Nothing to pay the rider.")}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">The bill appears here once the rider picks up your order.</p>
          )}
        </section>
      </main>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className={`flex justify-between ${strong ? "text-base font-extrabold" : ""}`}>
      <dt className={strong ? "" : "text-slate-600"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
