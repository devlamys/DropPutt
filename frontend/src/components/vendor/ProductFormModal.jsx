import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import Modal from "../Modal.jsx";
import api, { getErrorMessage, MULTIPART } from "../../utils/api.js";
import { compressImage } from "../../utils/image.js";
import { inr } from "../../utils/format.js";

const SLOTS = [
  ["ALL_DAY", "All day"],
  ["LUNCH_ONLY", "Lunch only"],
  ["EVENING_SNACKS_3_TO_6", "Evening snacks (3-6 PM)"],
  ["DINNER_ONLY", "Dinner only"],
];

const FOOD_CATEGORIES = [
  ["MEALS", "Meals"],
  ["BIRYANI", "Biryani"],
  ["FAST_FOOD", "Fast food"],
  ["SNACKS", "Chai & snacks"],
  ["JUICE_SHAKES", "Juice & shakes"],
  ["BAKERY_SWEETS", "Bakery & sweets"],
  ["OTHER", "Other"],
];

const field = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600";

/** Offer price from a percentage, in whole paise (display helper; the server validates). */
function priceAfterPercent(price, percent) {
  const paise = Math.round(Number(price) * 100);
  return (Math.round((paise * (100 - Number(percent))) / 100) / 100).toFixed(2);
}

const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Add or edit a menu item: details, photo, stock quantity and offer. */
export default function ProductFormModal({ product, onClose, onSaved, toast }) {
  const editing = Boolean(product);
  const [name, setName] = useState(product?.name ?? "");
  const [price, setPrice] = useState(product?.price ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [limited, setLimited] = useState(product ? product.stock_qty != null : false);
  const [stock, setStock] = useState(product?.stock_qty ?? 10);
  const [offerOn, setOfferOn] = useState(Boolean(product?.offer_price));
  const [offerMode, setOfferMode] = useState("price");
  const [offerValue, setOfferValue] = useState(product?.offer_price ?? "");
  const [offerLabel, setOfferLabel] = useState(product?.offer_label ?? "");
  const [offerEnds, setOfferEnds] = useState(toLocalInput(product?.offer_ends_at));
  const [slot, setSlot] = useState(product?.slot_type ?? "ALL_DAY");
  const [foodCategory, setFoodCategory] = useState(product?.food_category ?? "");
  const [from, setFrom] = useState(product?.available_from ?? "");
  const [to, setTo] = useState(product?.available_to ?? "");
  const [combo, setCombo] = useState(product?.is_combo ?? false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(product?.image_url ?? null);
  const [saving, setSaving] = useState(false);

  const offerPrice = !offerOn || !offerValue
    ? null
    : offerMode === "percent"
      ? priceAfterPercent(price, offerValue)
      : String(offerValue);

  function pickFile(event) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        name,
        price: String(price),
        description: description.trim() || null,
        slot_type: slot,
        ...(foodCategory ? { food_category: foodCategory } : {}),
        available_from: from && to ? from : null,
        available_to: from && to ? to : null,
        is_combo: combo,
        stock_qty: limited ? Number(stock) : null,
        offer_price: offerPrice,
        offer_label: offerPrice ? offerLabel.trim() || (offerMode === "percent" ? `${offerValue}% off` : "Offer") : null,
        offer_ends_at: offerPrice && offerEnds ? new Date(offerEnds).toISOString() : null,
      };
      const { data } = editing
        ? await api.patch(`/vendor/products/${product.id}`, body)
        : await api.post("/vendor/products", body);
      let saved = data.data.product;
      if (file) {
        const form = new FormData();
        form.set("image", await compressImage(file, { maxSide: 1200 }));
        const res = await api.post(`/vendor/products/${saved.id}/image`, form, MULTIPART);
        saved = res.data.data.product;
      }
      toast(editing ? "Item updated" : "Item added", "success");
      onSaved(saved);
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "Edit item" : "Add menu item"} onClose={onClose}>
      <form onSubmit={save} className="space-y-4 text-sm">
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-3">
          {preview ? (
            <img src={preview} alt="" className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
              <Camera className="h-6 w-6" />
            </span>
          )}
          <span className="font-medium text-slate-700">{preview ? "Change photo" : "Add a photo"}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pickFile} className="sr-only" />
        </label>

        <label className="block">
          <span className="mb-1 block font-medium">Item name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} placeholder="Chicken Biryani Full" />
        </label>

        <label className="block">
          <span className="mb-1 block font-medium">Food type (shown on the home tabs)</span>
          <select className={field} value={foodCategory} onChange={(e) => setFoodCategory(e.target.value)}>
            {!product && <option value="">Choose automatically</option>}
            {FOOD_CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block font-medium">Price (₹)</span>
            <input className={field} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required pattern="\d{1,7}(\.\d{1,2})?" />
          </label>
          <div>
            <span className="mb-1 block font-medium">Quantity</span>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} aria-label="Limit quantity" className="h-5 w-5" />
              {limited ? (
                <input className={field} type="number" min={0} max={9999} value={stock} onChange={(e) => setStock(e.target.value)} aria-label="Quantity available" />
              ) : (
                <span className="text-slate-500">Unlimited</span>
              )}
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block font-medium">Description (optional)</span>
          <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </label>

        <div className="rounded-2xl bg-orange-50 p-3">
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={offerOn} onChange={(e) => setOfferOn(e.target.checked)} className="h-5 w-5" />
            Run an offer / discount
          </label>
          {offerOn && (
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                <select className={field} value={offerMode} onChange={(e) => { setOfferMode(e.target.value); setOfferValue(""); }} aria-label="Offer type">
                  <option value="price">Offer price ₹</option>
                  <option value="percent">Discount %</option>
                </select>
                <input className={field} inputMode="decimal" value={offerValue} onChange={(e) => setOfferValue(e.target.value)} placeholder={offerMode === "percent" ? "20" : "160"} aria-label="Offer value" />
              </div>
              {offerPrice && Number(price) > 0 && (
                <p className="font-semibold text-orange-800">
                  <span className="line-through opacity-60">{inr(price)}</span> → {inr(offerPrice)} for the customer
                </p>
              )}
              <input className={field} value={offerLabel} onChange={(e) => setOfferLabel(e.target.value)} maxLength={30} placeholder="Label, e.g. Lunch special" aria-label="Offer label" />
              <label className="block">
                <span className="mb-1 block text-xs text-slate-600">Ends at (leave empty to keep until you remove it)</span>
                <input type="datetime-local" className={field} value={offerEnds} onChange={(e) => setOfferEnds(e.target.value)} />
              </label>
              <p className="text-xs text-slate-600">The discount comes from your price. Delivery fee and rider earnings do not change.</p>
            </div>
          )}
        </div>

        <details className="rounded-2xl border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium">Timing &amp; type</summary>
          <div className="mt-3 space-y-3">
            <select className={field} value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Time slot">
              {SLOTS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-slate-600">From<input type="time" className={field} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="block text-xs text-slate-600">To<input type="time" className={field} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={combo} onChange={(e) => setCombo(e.target.checked)} className="h-5 w-5" /> This is a combo</label>
          </div>
        </details>

        <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-green-600 py-3 font-bold text-white disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? "Save changes" : "Add item"}
        </button>
      </form>
    </Modal>
  );
}
