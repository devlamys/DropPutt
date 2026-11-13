import { Camera, Image as ImageIcon, Loader2, MapPin, Mic, Minus, Plus, RotateCcw, ShoppingBasket, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import api, { getErrorMessage, idempotencyHeaders } from "../utils/api.js";
import { inr } from "../utils/format.js";
import { compressImage } from "../utils/image.js";
import { readProfile, saveProfile, useStorefront } from "./shop/StorefrontContext.jsx";

const SHOP_CHIPS = [
  { label: "Medical Shop", emoji: "💊" },
  { label: "Bakery", emoji: "🥐" },
  { label: "Coolbar", emoji: "🥤" },
  { label: "Grocery", emoji: "🛒" },
  { label: "Any Shop", emoji: "🏪" },
];
const MAX_ITEMS = 30;
const MAX_VOICE_SECONDS = 60;
const MIN_VOICE_BYTES = 1500;
const VOICE_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

const digits = (value) => value.replace(/\D/g, "");
const validPhone = (value) => {
  let d = digits(value);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d);
};
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const press = "transition-transform active:scale-[0.98]";
const card = "rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm";
const field =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";

function CardTitle({ n, title, ml, optional }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{n}</span>
      <span>
        {title} {ml && <span className="font-semibold text-slate-500">• {ml}</span>}
      </span>
      {optional && <span className="ml-auto text-xs font-medium text-slate-400">optional</span>}
    </h3>
  );
}

/** 1-tap voice note: tap to start, tap to stop, then preview. Calls onChange(Blob | null). */
function useVoiceNote(onChange) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef(null);
  const timer = useRef(null);
  const supported =
    typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  const stop = useCallback(() => {
    clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
        if (blob.size < MIN_VOICE_BYTES) setError("That was too short. Tap the mic and speak a little longer.");
        else onChange(blob);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_VOICE_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setError(err?.name === "NotAllowedError" ? "Microphone is blocked. Allow it in your browser settings and try again." : "Couldn't start the microphone on this phone.");
    }
  }, [onChange, stop]);

  useEffect(
    () => () => {
      clearInterval(timer.current);
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      recorder.current?.stream?.getTracks().forEach((t) => t.stop());
    },
    []
  );
  return { recording, seconds, error, supported, start, stop };
}

/**
 * "Buy Anything" request: what to buy (shop, checklist, photo of a handwritten
 * list or prescription, voice note), where to deliver, and a rider call.
 * Submits to POST /api/v1/marketplace/orders with order_type CUSTOM_BUY.
 */
export default function CustomBuyModal({ zones, zoneId, onZone, onClose, onPlaced }) {
  const { toast } = useStorefront();
  const profile = readProfile();
  const nextId = useRef(2);
  const [shop, setShop] = useState("");
  const [items, setItems] = useState([{ id: 1, name: "", qty: 1 }]);
  const [photo, setPhoto] = useState(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [voice, setVoice] = useState(null);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [phone, setPhone] = useState(profile.phone || "");
  const [name, setName] = useState(profile.name || "");
  const [address, setAddress] = useState(profile.address || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [zonesTimedOut, setZonesTimedOut] = useState(false);
  // One key per attempt: a retry after a flaky network replays the same order.
  const attempt = useRef(null);
  const cameraInput = useRef(null);
  const galleryInput = useRef(null);
  const lastRow = useRef(null);

  const recorder = useVoiceNote(setVoice);

  // Preview URLs for the photo and the voice note.
  useEffect(() => {
    if (!photo) return setPhotoUrl("");
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    if (!voice) return setVoiceUrl("");
    const url = URL.createObjectURL(voice);
    setVoiceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voice]);

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

  useEffect(() => {
    if (zones.length) return undefined;
    const t = setTimeout(() => setZonesTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [zones.length]);

  const setRow = (id, patch) => setItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // Functional, so two quick taps on + or - both count.
  const bumpQty = (id, delta) =>
    setItems((rows) => rows.map((r) => (r.id === id ? { ...r, qty: Math.min(99, Math.max(1, r.qty + delta)) } : r)));
  const addRow = () => {
    if (items.length >= MAX_ITEMS) return;
    setItems((rows) => [...rows, { id: nextId.current++, name: "", qty: 1 }]);
    setTimeout(() => lastRow.current?.focus(), 50);
  };
  const removeRow = (id) => setItems((rows) => (rows.length === 1 ? [{ id, name: "", qty: 1 }] : rows.filter((r) => r.id !== id)));

  const pickPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) setPhoto(await compressImage(file));
  };

  const named = items.filter((r) => r.name.trim());
  const zone = zones.find((z) => String(z.id) === String(zoneId));

  const problems = [];
  if (!named.length && !photo && !voice) problems.push("Add an item, a photo of your list, or a voice note");
  if (!zone) problems.push("Choose your delivery area");
  if (address.trim().length < 3) problems.push("Add your address or a landmark");
  if (!validPhone(phone)) problems.push("Enter your 10-digit mobile number");
  const blocked = problems.length > 0;

  const submit = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (blocked || busy) return;
    if (recorder.recording) recorder.stop();
    setBusy(true);
    setError("");
    attempt.current ??= idempotencyHeaders();

    const form = new FormData();
    form.set("order_type", "CUSTOM_BUY");
    form.set("zone_id", String(zoneId));
    form.set("customer_phone", phone);
    if (name.trim()) form.set("customer_name", name.trim());
    form.set("drop_address", address.trim());
    if (shop.trim()) form.set("shop_name", shop.trim());
    if (named.length) form.set("items", JSON.stringify(named.map((r) => ({ name: r.name.trim(), qty: r.qty }))));
    if (photo) form.set("photo", photo, photo.name || "list.jpg");
    if (voice) {
      const ext = voice.type.includes("mp4") ? "m4a" : voice.type.includes("ogg") ? "ogg" : "webm";
      form.set("voice", voice, `note.${ext}`);
    }

    try {
      const { data } = await api.post("/marketplace/orders", form, {
        skipAuth: true,
        timeout: 60_000,
        headers: { "Content-Type": "multipart/form-data", ...attempt.current },
      });
      saveProfile({ phone, name: name.trim(), address: address.trim(), zone_id: zoneId });
      onPlaced({ ...data.data, kind: "CUSTOM_BUY" });
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 motion-safe:animate-fade-in" role="dialog" aria-modal="true" aria-label="Buy Anything">
      <form onSubmit={submit} noValidate className="flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl motion-safe:animate-sheet-up">
        <header className="flex items-start justify-between gap-3 bg-white px-5 py-4 shadow-sm">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-900">
              <ShoppingBasket className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-slate-900">
                Buy Anything <span className="font-bold text-slate-500">• എന്തും വാങ്ങാം</span>
              </h2>
              <p className="text-xs text-slate-500">Tell us what you need. A rider buys it and brings it to you.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 ${press}`}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {/* 1 — shop */}
          <section className={card}>
            <CardTitle n="1" title="Which shop?" ml="ഏത് കട?" optional />
            <input className={field} placeholder="Shop name or place" value={shop} onChange={(e) => setShop(e.target.value)} maxLength={150} aria-label="Shop name" />
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick shop choices">
              {SHOP_CHIPS.map((chip) => {
                const on = shop === chip.label;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setShop(on ? "" : chip.label)}
                    className={`flex h-12 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-bold ${press} ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}
                  >
                    <span aria-hidden="true">{chip.emoji}</span>
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2 — checklist */}
          <section className={card}>
            <CardTitle n="2" title="Your list" ml="സാധനങ്ങളുടെ ലിസ്റ്റ്" />
            <ul className="space-y-2.5">
              {items.map((row, index) => (
                <li key={row.id} className="flex items-center gap-2">
                  <input
                    ref={index === items.length - 1 ? lastRow : null}
                    className={`${field} min-w-0 flex-1`}
                    placeholder={index === 0 ? "e.g. Paracetamol 500mg" : "Item name"}
                    aria-label={`Item ${index + 1} name`}
                    value={row.name}
                    maxLength={80}
                    onChange={(e) => setRow(row.id, { name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (row.name.trim()) addRow();
                      }
                    }}
                  />
                  <div className="flex h-12 shrink-0 items-center rounded-2xl border border-slate-200 bg-white">
                    <button type="button" aria-label={`Fewer ${row.name || "items"}`} onClick={() => bumpQty(row.id, -1)} className="flex h-12 w-10 items-center justify-center text-slate-700">
                      <Minus className="h-4 w-4" strokeWidth={3} />
                    </button>
                    <span className="w-6 text-center text-sm font-bold tabular-nums" aria-label={`Quantity ${row.qty}`}>{row.qty}</span>
                    <button type="button" aria-label={`More ${row.name || "items"}`} onClick={() => bumpQty(row.id, 1)} className="flex h-12 w-10 items-center justify-center text-slate-700">
                      <Plus className="h-4 w-4" strokeWidth={3} />
                    </button>
                  </div>
                  <button type="button" aria-label={`Remove item ${index + 1}`} onClick={() => removeRow(row.id)} className="flex h-12 w-10 shrink-0 items-center justify-center rounded-2xl text-slate-400 hover:bg-slate-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addRow}
              disabled={items.length >= MAX_ITEMS}
              className={`mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-600 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 ${press}`}
            >
              <Plus className="h-4 w-4" strokeWidth={3} /> Add Item
            </button>
          </section>

          {/* 3 — photo */}
          <section className={card}>
            <CardTitle n="3" title="Photo of your list" ml="ലിസ്റ്റിന്റെ ഫോട്ടോ" optional />
            <p className="-mt-1 mb-3 text-xs text-slate-500">A handwritten list or a doctor's prescription. The rider reads it at the shop.</p>
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} aria-label="Take a photo" />
            <input ref={galleryInput} type="file" accept="image/*" className="hidden" onChange={pickPhoto} aria-label="Choose a photo from gallery" />
            {photoUrl ? (
              <div className="relative overflow-hidden rounded-2xl ring-1 ring-slate-200">
                <img src={photoUrl} alt="Your list" className="max-h-56 w-full bg-slate-100 object-contain" />
                <div className="absolute right-2 top-2 flex gap-2">
                  <button type="button" onClick={() => cameraInput.current?.click()} aria-label="Retake photo" className={`flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow ${press}`}>
                    <RotateCcw className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo" className={`flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-red-600 shadow ${press}`}>
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => cameraInput.current?.click()} className={`flex h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 ${press}`}>
                  <Camera className="h-5 w-5" /> Take photo
                </button>
                <button type="button" onClick={() => galleryInput.current?.click()} className={`flex h-14 items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-700 ${press}`}>
                  <ImageIcon className="h-5 w-5" /> Gallery
                </button>
              </div>
            )}
          </section>

          {/* 4 — voice note */}
          <section className={card}>
            <CardTitle n="4" title="Voice note" ml="ശബ്ദ സന്ദേശം" optional />
            {!recorder.supported ? (
              <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">Voice notes aren't supported on this browser. Type your list above instead.</p>
            ) : voice ? (
              <div className="space-y-2">
                <audio controls src={voiceUrl} className="w-full" aria-label="Preview your voice note" />
                <button
                  type="button"
                  onClick={() => {
                    setVoice(null);
                    recorder.start();
                  }}
                  className={`flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-700 ${press}`}
                >
                  <RotateCcw className="h-4 w-4" /> Record again
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={recorder.recording ? recorder.stop : recorder.start}
                aria-pressed={recorder.recording}
                className={`flex h-14 w-full items-center justify-center gap-3 rounded-2xl text-base font-bold ${press} ${recorder.recording ? "bg-red-600 text-white" : "bg-amber-400 text-slate-900 hover:bg-amber-500"}`}
              >
                {recorder.recording ? (
                  <>
                    <span className="h-3 w-3 animate-pulse rounded-full bg-white" />
                    <Square className="h-4 w-4 fill-current" /> Tap to stop · <span className="tabular-nums">{clock(recorder.seconds)}</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-5 w-5" /> Tap to record
                  </>
                )}
              </button>
            )}
            {recorder.error && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{recorder.error}</p>}
          </section>

          {/* 5 — delivery details */}
          <section className={card}>
            <CardTitle n="5" title="Deliver to" ml="എത്തിക്കേണ്ട സ്ഥലം" />
            <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Delivery area">
              {zones.length === 0 &&
                !zonesTimedOut &&
                Array.from({ length: 3 }, (_, i) => <span key={i} className="h-12 w-40 animate-pulse rounded-full bg-slate-200" aria-hidden="true" />)}
              {zones.length === 0 && zonesTimedOut && <p className="text-sm text-slate-500">No delivery areas are set up yet. Please try again later.</p>}
              {zones.map((z) => {
                const active = String(z.id) === String(zoneId);
                return (
                  <button
                    key={z.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${z.zone_name}, delivery ${inr(z.delivery_fee)}`}
                    onClick={() => onZone(z.id)}
                    className={`flex h-12 items-center gap-1.5 rounded-full border-2 px-4 text-sm font-bold ${press} ${active ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"}`}
                  >
                    <MapPin className="h-4 w-4 shrink-0" />
                    {z.zone_name.split("—").pop().trim()}
                    <span className="tabular-nums text-slate-500">· {inr(z.delivery_fee)}</span>
                  </button>
                );
              })}
            </div>
            <textarea className={field} rows={2} placeholder="House name, nearest landmark" aria-label="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
            <div className="mt-2.5 grid grid-cols-5 gap-2.5">
              <input className={`${field} col-span-3`} inputMode="numeric" autoComplete="tel" aria-label="Mobile number" placeholder="10-digit mobile" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={14} />
              <input className={`${field} col-span-2`} autoComplete="given-name" aria-label="Your name (optional)" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
          </section>

          {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">{error}</p>}
        </div>

        {/* sticky bottom action */}
        <footer className="bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          {touched && blocked ? (
            <p className="mb-2 text-center text-sm font-semibold text-amber-800">{problems[0]}</p>
          ) : (
            <p className="mb-2 text-center text-xs text-slate-500">
              Delivery <b className="tabular-nums text-slate-800">{zone ? inr(zone.delivery_fee) : "from ₹30"}</b> + the shop bill. The rider confirms the amount before buying.
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            aria-disabled={blocked}
            className={`flex h-14 w-full flex-col items-center justify-center rounded-2xl text-white ${press} ${blocked ? "bg-slate-400" : "bg-emerald-600 shadow-lg shadow-emerald-900/25 hover:bg-emerald-700"}`}
          >
            <span className="flex items-center gap-2 text-base font-extrabold leading-tight">
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              {busy ? "Booking your rider…" : "Book Rider Now (COD)"}
            </span>
            {!busy && <span className="text-[11px] font-semibold leading-tight text-emerald-100">റൈഡറെ ഇപ്പോൾ വിളിക്കാം</span>}
          </button>
        </footer>
      </form>
    </div>
  );
}
