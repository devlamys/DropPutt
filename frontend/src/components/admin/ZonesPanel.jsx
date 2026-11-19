import { Crosshair, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

const field = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";

/**
 * Franchise admin: how far we deliver and what each distance costs.
 * The software picks the band from the distance between the hotel and the
 * customer's pin, so the customer never chooses a zone.
 */
export default function ZonesPanel({ franchise, onUpdated, toast }) {
  const [zones, setZones] = useState(null);
  const [editing, setEditing] = useState(null); // zone | "new" | null
  const [form, setForm] = useState({ zone_name: "", max_km: "", delivery_fee: "", min_order_value: "" });
  const [limit, setLimit] = useState(String(Number(franchise.max_delivery_km ?? 14)));
  const [busy, setBusy] = useState(null);
  const off = (value) => (Number(value) > 0 ? String(Number(value)) : "");
  const [discount, setDiscount] = useState({ min: off(franchise.delivery_discount_min), amount: off(franchise.delivery_discount_amount) });
  const [stopFee, setStopFee] = useState(String(Number(franchise.extra_stop_fee ?? 20)));
  const [where, setWhere] = useState({
    address: franchise.address ?? "",
    lat: franchise.lat != null ? String(Number(franchise.lat)) : "",
    lng: franchise.lng != null ? String(Number(franchise.lng)) : "",
  });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/zones");
      setZones(data.data.zones);
    } catch (error) {
      toast(getErrorMessage(error), "error");
      setZones([]);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function saveLimit() {
    setBusy("limit");
    try {
      const { data } = await api.patch("/admin/franchise/settings", { max_delivery_km: Number(limit) });
      onUpdated(data.data.franchise);
      toast(`We now deliver up to ${Number(data.data.franchise.max_delivery_km)} km`, "success");
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  function useHere() {
    if (!("geolocation" in navigator)) return toast("This device cannot share its location.", "error");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setWhere((w) => ({ ...w, lat: coords.latitude.toFixed(6), lng: coords.longitude.toFixed(6) })),
      () => toast("Could not get the location. Type the latitude and longitude instead.", "error"),
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  }

  async function saveDiscount() {
    setBusy("discount");
    try {
      const { data } = await api.patch("/admin/franchise/settings", {
        delivery_discount_min: String(Number(discount.min || 0)),
        delivery_discount_amount: String(Number(discount.amount || 0)),
      });
      onUpdated(data.data.franchise);
      const f = data.data.franchise;
      toast(Number(f.delivery_discount_min) > 0 ? `${inr(f.delivery_discount_amount)} off delivery on orders of ${inr(f.delivery_discount_min)}+` : "Delivery discount switched off", "success");
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  async function saveStopFee() {
    setBusy("stop");
    try {
      const { data } = await api.patch("/admin/franchise/settings", { extra_stop_fee: String(Number(stopFee)) });
      onUpdated(data.data.franchise);
      toast(`Extra shop in one trip: ${inr(data.data.franchise.extra_stop_fee)}`, "success");
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  async function saveWhere() {
    if (where.lat === "" || where.lng === "") return toast("Enter the franchise's latitude and longitude.", "error");
    setBusy("where");
    try {
      const { data } = await api.patch("/admin/franchise/settings", { address: where.address.trim(), lat: Number(where.lat), lng: Number(where.lng) });
      onUpdated(data.data.franchise);
      toast("Franchise location saved", "success");
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  function open(zone) {
    setEditing(zone);
    setForm(zone === "new" ? { zone_name: "", max_km: "", delivery_fee: "", min_order_value: "" } : { zone_name: zone.zone_name, max_km: String(Number(zone.max_km)), delivery_fee: String(Number(zone.delivery_fee)), min_order_value: off(zone.min_order_value) });
  }

  async function saveZone(event) {
    event.preventDefault();
    setBusy("zone");
    try {
      const body = { zone_name: form.zone_name.trim(), max_km: Number(form.max_km), delivery_fee: String(form.delivery_fee), min_order_value: String(Number(form.min_order_value || 0)) };
      if (editing === "new") await api.post("/admin/zones", body);
      else await api.patch(`/admin/zones/${editing.id}`, body);
      toast("Saved", "success");
      setEditing(null);
      await load();
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(zone) {
    if (!window.confirm(`Delete "${zone.zone_name}"?`)) return;
    try {
      await api.delete(`/admin/zones/${zone.id}`);
      toast("Deleted", "success");
      await load();
    } catch (error) {
      toast(getErrorMessage(error), "error");
    }
  }

  let from = 0;
  return (
    <section className="mt-6 rounded-2xl bg-white p-4 ring-1 ring-slate-200" aria-labelledby="zones-heading">
      <h3 id="zones-heading" className="font-bold">Delivery distance &amp; charges</h3>
      <p className="mt-1 text-sm text-slate-600">
        The charge follows the distance from the hotel to the customer&apos;s pin. Beyond the maximum distance, orders are refused.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="max-km" className="font-semibold">Maximum delivery distance</label>
        <input id="max-km" type="number" min="0.5" max="50" step="0.5" value={limit} onChange={(e) => setLimit(e.target.value)} className="w-24 rounded-xl border border-slate-300 px-3 py-2" />
        <span className="text-slate-500">km</span>
        <button type="button" onClick={saveLimit} disabled={busy === "limit"} className="rounded-xl bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-60">
          {busy === "limit" ? "…" : "Save"}
        </button>
      </div>

      <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm ring-1 ring-emerald-200">
        <h4 className="font-bold text-emerald-900">Delivery discount</h4>
        <p className="mt-0.5 text-xs text-emerald-900/80">Customers see a progress bar in their cart: &quot;Add ₹X more to get ₹Y off delivery&quot;. You pay the discount from your profit; the rider still gets the whole delivery charge. Leave both empty to switch it off.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="disc-min" className="font-semibold">Food order of</label>
          <input id="disc-min" type="number" min="0" step="10" placeholder="350" value={discount.min} onChange={(e) => setDiscount({ ...discount, min: e.target.value })} className="w-24 rounded-xl border border-slate-300 px-3 py-2" />
          <label htmlFor="disc-amt" className="font-semibold">or more gets ₹</label>
          <input id="disc-amt" type="number" min="0" max="500" step="5" placeholder="20" value={discount.amount} onChange={(e) => setDiscount({ ...discount, amount: e.target.value })} className="w-20 rounded-xl border border-slate-300 px-3 py-2" />
          <span className="text-slate-600">off delivery</span>
          <button type="button" onClick={saveDiscount} disabled={busy === "discount"} className="rounded-xl bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-60">{busy === "discount" ? "…" : "Save"}</button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="stop-fee" className="font-semibold">Extra charge per additional shop (deliver together)</label>
        <input id="stop-fee" type="number" min="0" max="200" step="1" value={stopFee} onChange={(e) => setStopFee(e.target.value)} className="w-24 rounded-xl border border-slate-300 px-3 py-2" />
        <button type="button" onClick={saveStopFee} disabled={busy === "stop"} className="rounded-xl bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-60">
          {busy === "stop" ? "…" : "Save"}
        </button>
        <p className="w-full text-xs text-slate-500">When a customer has 2-3 shops delivered together, the trip costs the farthest shop&apos;s charge plus this amount for every other shop. The rider keeps all of it.</p>
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
        <h4 className="text-sm font-bold">Franchise address &amp; location</h4>
        <p className="mt-0.5 text-xs text-slate-500">Customers near you see this franchise first. Without a location it is not listed.</p>
        <label htmlFor="fr-address" className="mt-2 block text-xs font-semibold">Address</label>
        <input id="fr-address" type="text" maxLength={200} value={where.address} onChange={(e) => setWhere({ ...where, address: e.target.value })} placeholder="Town, landmark" className={`${field} mt-1`} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="fr-lat" className="block text-xs font-semibold">Latitude</label>
            <input id="fr-lat" type="number" step="any" min="-90" max="90" value={where.lat} onChange={(e) => setWhere({ ...where, lat: e.target.value })} className={`${field} mt-1`} />
          </div>
          <div>
            <label htmlFor="fr-lng" className="block text-xs font-semibold">Longitude</label>
            <input id="fr-lng" type="number" step="any" min="-180" max="180" value={where.lng} onChange={(e) => setWhere({ ...where, lng: e.target.value })} className={`${field} mt-1`} />
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={useHere} className="flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"><Crosshair className="h-4 w-4" /> Use this device</button>
          <button type="button" onClick={saveWhere} disabled={busy === "where"} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy === "where" ? "…" : "Save location"}</button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h4 className="text-sm font-bold">Charges by distance</h4>
        <button type="button" onClick={() => open("new")} className="flex items-center gap-1 rounded-full bg-green-600 px-3 py-1.5 text-xs font-bold text-white">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {zones === null ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : (
        <ul className="mt-2 divide-y rounded-xl ring-1 ring-slate-200">
          {zones.map((zone) => {
            const label = `${from}–${Number(zone.max_km)} km`;
            from = Number(zone.max_km);
            return (
              <li key={zone.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{zone.zone_name}</p>
                  <p className="text-xs text-slate-500">{label}{Number(zone.min_order_value) > 0 ? ` · min order ${inr(zone.min_order_value)}` : ""}</p>
                </div>
                <span className="font-bold tabular-nums">{inr(zone.delivery_fee)}</span>
                <button type="button" aria-label={`Edit ${zone.zone_name}`} onClick={() => open(zone)} className="rounded-full p-2 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                <button type="button" aria-label={`Delete ${zone.zone_name}`} onClick={() => remove(zone)} className="rounded-full p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <form onSubmit={saveZone} className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
          <label className="text-xs font-semibold">Name<input className={field} value={form.zone_name} onChange={(e) => setForm({ ...form, zone_name: e.target.value })} required minLength={2} /></label>
          <label className="text-xs font-semibold">Up to (km)<input className={field} type="number" step="0.5" min="0.5" max="50" value={form.max_km} onChange={(e) => setForm({ ...form, max_km: e.target.value })} required /></label>
          <label className="text-xs font-semibold">Charge (₹)<input className={field} inputMode="decimal" value={form.delivery_fee} onChange={(e) => setForm({ ...form, delivery_fee: e.target.value })} required /></label>
          <label className="text-xs font-semibold">Min order (₹)<input className={field} inputMode="decimal" placeholder="0 = shop's own" value={form.min_order_value} onChange={(e) => setForm({ ...form, min_order_value: e.target.value })} /></label>
          <div className="flex gap-2">
            <button disabled={busy === "zone"} className="rounded-xl bg-green-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">Save</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-xl border px-3 py-2 text-sm font-semibold">Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
