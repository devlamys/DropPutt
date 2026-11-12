import { Camera, Loader2, LocateFixed } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "../Modal.jsx";
import api, { MULTIPART, getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { PAYMENT_LABELS, inr } from "../../utils/format.js";
import { compressImage } from "../../utils/image.js";

/** Captures the rider's gate GPS (becomes the customer's verified location). */
export default function DeliveredModal({ order, onClose, onDelivered }) {
  const [fix, setFix] = useState(null);
  const [gpsState, setGpsState] = useState("locating"); // locating | ok | error
  const [photo, setPhoto] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // One key per modal: a retry after a network timeout never delivers twice.
  const headers = useRef(idempotencyHeaders());

  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  const locate = useCallback(() => {
    setGpsState("locating");
    if (!("geolocation" in navigator)) return setGpsState("error");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setFix({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy });
        setGpsState("ok");
      },
      () => setGpsState("error"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }, []);
  useEffect(locate, [locate]);

  async function onPhoto(event) {
    const file = event.target.files?.[0];
    if (file) setPhoto(await compressImage(file));
  }

  async function confirm() {
    if (!fix) return;
    setBusy(true);
    setProblem("");
    try {
      let gate_photo_url;
      if (photo) {
        const form = new FormData();
        form.append("gate_photo", photo);
        const { data } = await api.post(`/orders/${order.id}/gate-photo`, form, MULTIPART);
        gate_photo_url = data.data.gate_photo_url;
      }
      const body = {
        rider_lat: fix.lat,
        rider_lng: fix.lng,
        ...(note.trim() ? { rider_delivery_note: note.trim() } : {}),
        ...(gate_photo_url ? { gate_photo_url } : {}),
      };
      const { data } = await api.post(`/orders/${order.id}/deliver`, body, { headers: headers.current });
      onDelivered(data.data);
    } catch (error) {
      setProblem(getErrorMessage(error, "Could not complete the delivery."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Deliver #${order.order_number}`} onClose={busy ? () => {} : onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-orange-50 p-3 text-center">
          <p className="text-xs font-semibold uppercase text-orange-700">Cash to collect</p>
          <p className="text-2xl font-extrabold text-orange-700">{inr(order.amount_to_collect)}</p>
          <p className="text-xs text-slate-600">{PAYMENT_LABELS[order.payment_method]}</p>
        </div>

        <div
          className={`flex items-center gap-3 rounded-xl p-3 text-sm ${
            gpsState === "ok" ? "bg-green-50 text-green-800" : gpsState === "error" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {gpsState === "locating" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
          <div className="min-w-0 flex-1">
            {gpsState === "locating" && "Getting your gate location…"}
            {gpsState === "ok" && (
              <>
                Gate location captured <span className="text-xs">(±{Math.round(fix.accuracy)} m)</span>
                {fix.accuracy > 50 && <p className="text-xs">Weak GPS — step outside the gate and retry.</p>}
              </>
            )}
            {gpsState === "error" && "Could not read GPS. Allow location access and retry."}
          </div>
          <button type="button" onClick={locate} className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold">
            Retry
          </button>
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">Gate photo (optional)</label>
          <label className="flex min-h-[5rem] cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500">
            {previewUrl ? (
              <img src={previewUrl} alt="Gate preview" className="max-h-40 object-contain" />
            ) : (
              <>
                <Camera className="h-6 w-6" /> <span className="text-sm font-medium">Take gate / house photo</span>
              </>
            )}
            <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="sr-only" />
          </label>
        </div>

        <div>
          <label htmlFor="delivery-note" className="mb-1 block text-sm font-semibold">
            Delivery note (optional)
          </label>
          <textarea
            id="delivery-note"
            rows={2}
            maxLength={500}
            placeholder="e.g. Blue gate near the mosque"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
          />
          <p className="mt-1 text-xs text-slate-500">Saved to help the next rider find this house.</p>
        </div>

        {problem && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {problem}
          </p>
        )}

        <button
          type="button"
          onClick={confirm}
          disabled={busy || !fix}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-green-600 py-4 text-lg font-bold text-white shadow active:scale-95 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-5 w-5 animate-spin" />}
          Confirm delivered
        </button>
      </div>
    </Modal>
  );
}
