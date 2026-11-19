import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api, { getErrorMessage, getRequestSlug, switchShopFranchise } from "../../utils/api.js";
import { fetchPlaceName } from "../../utils/place.js";

import LocationPicker from "./LocationPicker.jsx";
import DiscountBar from "./DiscountBar.jsx";
import { readProfile, saveProfile, useStorefront } from "./StorefrontContext.jsx";

const publicApi = { skipAuth: true };

/**
 * Bottom-sheet "Where should we deliver?": share the current location, search a place and drag
 * the pin to the exact house. The pin is remembered on this phone. Under the map the franchises
 * are listed nearest first (green: the pin is inside its delivery limit, red: it is not); the
 * nearest one that delivers there is selected automatically whenever the pin moves, and the
 * customer may tap another. The switch happens on Done / close. No charge is shown: it depends on
 * the shop, so only the out-of-delivery-area warning appears.
 */
export default function ZoneSheet({ onClose, onPlace, cartCount = 0, onClearCart }) {
  const { feed } = useStorefront();
  const profile = readProfile();
  const current = getRequestSlug();
  const [pin, setPin] = useState(profile.lat != null && profile.lng != null ? { lat: profile.lat, lng: profile.lng } : null);
  const [list, setList] = useState(null);
  const [listError, setListError] = useState("");
  const [chosen, setChosen] = useState(current); // slug that will be used after Done
  const [asking, setAsking] = useState(false); // "switching clears your cart"
  const rowRef = useRef(null);

  // Name the area for the header label once the pin stops moving.
  useEffect(() => {
    if (!pin) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      const name = await fetchPlaceName(pin.lat, pin.lng);
      if (live && name) onPlace?.(name);
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pin?.lat, pin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Franchises for this pin, nearest first. Two requests: an instant estimate (straight line) for the
  // first paint, then the road distance, which decides green / red and the automatic selection.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!pin) return undefined;
    let live = true;
    const apply = (franchises) => {
      setList(franchises);
      setListError("");
      setAsking(false);
      setChosen(franchises.find((f) => f.within_limit)?.slug ?? current);
    };
    const get = (precise) => api.get("/public/franchises/nearby", { ...publicApi, params: { lat: pin.lat, lng: pin.lng, precise } });
    // No wait when the sheet opens; wait for the pin to settle while it is being dragged.
    const delay = firstLoad.current ? 0 : 400;
    firstLoad.current = false;
    const timer = setTimeout(() => {
      let preciseDone = false;
      get("0")
        .then(({ data }) => live && !preciseDone && apply(data.data.franchises))
        .catch(() => {});
      get("1")
        .then(({ data }) => {
          preciseDone = true;
          if (live) apply(data.data.franchises);
        })
        .catch((err) => live && !preciseDone && setListError(getErrorMessage(err, "Could not load the nearby franchises.")));
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pin?.lat, pin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selected franchise in view: after the list changes or another card is tapped, scroll the row to it.
  useEffect(() => {
    const row = rowRef.current;
    const card = row?.querySelector('[aria-pressed="true"]')?.parentElement;
    if (row && card) row.scrollTo({ left: Math.max(0, card.offsetLeft - 4), behavior: "smooth" });
  }, [list, chosen]);

  const done = () => {
    if (pin) saveProfile({ lat: pin.lat, lng: pin.lng });
    if (chosen === current) return onClose();
    if (cartCount > 0 && !asking) return setAsking(true);
    if (cartCount > 0) onClearCart?.();
    switchShopFranchise(chosen);
  };
  const chosenName = list?.find((f) => f.slug === chosen)?.name;

  const close = () => (asking ? setAsking(false) : done());

  return (
    <div className="fixed inset-0 z-[600] flex items-end justify-center bg-black/60 motion-safe:animate-fade-in sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Delivery location" onClick={close}>
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl bg-white motion-safe:animate-sheet-up sm:max-w-md sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 className="text-lg font-bold">Delivery location</h2>
          <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
      <div className="flex-1 overflow-y-auto px-5 pb-3">
        <LocationPicker
          shop={null}
          hideCharge
          pin={pin}
          onChange={(next) => {
            setPin(next);
            saveProfile({ lat: next.lat, lng: next.lng });
          }}
        />
        {listError && <p className="mt-3 text-sm text-amber-700">{listError}</p>}
        {pin && !list && !listError && (
          <div className="mt-3 flex gap-2 overflow-hidden" aria-busy="true" aria-label="Finding nearby franchises">
            {[0, 1, 2].map((i) => <div key={i} className="h-[4.75rem] w-44 shrink-0 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
        )}
        {pin && list && list.length > 0 && (
          <section className="mt-3" aria-label="Nearby franchises">
            <ul ref={rowRef} className="relative -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {list.map((f) => {
                const on = f.slug === chosen;
                const ok = f.within_limit;
                const exact = f.precise !== false;
                return (
                  <li key={f.slug} className="w-44 shrink-0 snap-start">
                    <button
                      type="button"
                      disabled={!ok && exact}
                      onClick={() => { setChosen(f.slug); setAsking(false); }}
                      aria-pressed={on}
                      aria-label={`${f.name}, ${f.km} km${ok ? "" : ", too far to deliver"}`}
                      className={`flex h-full w-full flex-col rounded-xl border bg-white p-3 text-left ${on ? "border-2 border-[#E8431A]" : "border-slate-200"} ${ok ? "" : "opacity-80"}`}
                    >
                      <span className="truncate text-sm font-bold text-slate-900">{f.name}</span>
                      <span className="truncate text-xs text-slate-500">{f.address || " "}</span>
                      <span className={`mt-1 text-sm font-bold tabular-nums ${!exact ? "text-slate-400" : ok ? "text-green-700" : "text-red-600"}`}>{exact ? "" : "~"}{f.km} km</span>
                      {!ok && exact && <span className="text-[11px] font-semibold leading-tight text-red-600">Outside its {Number(f.max_delivery_km)} km limit</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {asking && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
            Your cart is from another franchise. Switching to {chosenName ?? "it"} clears it. Press Done again to switch, or close this to cancel.
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 bg-white px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <button type="button" onClick={done} className="h-12 w-full rounded-lg bg-[#E8431A] text-base font-bold text-white active:scale-[0.98]">
          {asking ? "Switch & clear cart" : "Done"}
        </button>
      </div>
      </div>
    </div>
  );
}
