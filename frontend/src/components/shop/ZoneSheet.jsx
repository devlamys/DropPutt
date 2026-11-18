import { useEffect, useState } from "react";
import api, { getErrorMessage, getRequestSlug, switchShopFranchise } from "../../utils/api.js";
import { fetchPlaceName } from "../../utils/place.js";
import AppBar from "./AppBar.jsx";
import LocationPicker from "./LocationPicker.jsx";
import { readProfile, saveProfile } from "./StorefrontContext.jsx";

/**
 * "Where should we deliver?" Use the current location, search a place, and drag the
 * pin to the exact house. The pin is remembered on this phone and pre-fills every
 * order form. No charge is shown here: it depends on which shop the order is from,
 * so only the out-of-delivery-area warning appears.
 */
const publicApi = { skipAuth: true };

/** Franchises nearest the pin first. Green: this pin is inside its delivery limit. Red: it is not. */
function FranchiseList({ pin, cartCount, onClear }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(null); // slug waiting for "clear my cart?"
  const current = getRequestSlug();

  useEffect(() => {
    if (!pin) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api
        .get("/public/franchises/nearby", { ...publicApi, params: { lat: pin.lat, lng: pin.lng } })
        .then(({ data }) => live && (setList(data.data.franchises), setError("")))
        .catch((err) => live && setError(getErrorMessage(err, "Could not load the nearby franchises.")));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pin?.lat, pin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pin) return null;
  if (error) return <p className="mt-3 text-sm text-amber-700">{error}</p>;
  if (!list || list.length === 0) return null;

  const choose = (slug) => {
    if (cartCount > 0) return setAsking(slug);
    switchShopFranchise(slug);
  };

  return (
    <section className="mt-3" aria-label="Nearby franchises">
      <h3 className="mb-2 text-sm font-bold text-slate-700">Nearest franchises • അടുത്തുള്ള ഫ്രാഞ്ചൈസി</h3>
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {list.map((f) => {
          const selected = f.slug === current;
          const ok = f.within_limit;
          return (
            <li key={f.slug} className="w-44 shrink-0 snap-start">
              <button
                type="button"
                disabled={selected || !ok}
                onClick={() => choose(f.slug)}
                aria-pressed={selected}
                aria-label={`${f.name}, ${f.km} km${ok ? "" : ", too far to deliver"}`}
                className={`flex h-full w-full flex-col rounded-xl border bg-white p-3 text-left ${selected ? "border-2 border-[#E8431A]" : "border-slate-200"} ${!ok && !selected ? "opacity-80" : ""}`}
              >
                <span className="truncate text-sm font-bold text-slate-900">{f.name}</span>
                <span className="truncate text-xs text-slate-500">{f.address || "\u00a0"}</span>
                <span className={`mt-1 text-sm font-bold tabular-nums ${ok ? "text-green-700" : "text-red-600"}`}>{f.km} km</span>
                {!ok && <span className="text-[11px] font-semibold leading-tight text-red-600">Outside its {Number(f.max_delivery_km)} km limit</span>}
              </button>
              {asking === f.slug && (
                <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="text-slate-700">Switching clears your cart.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setAsking(null)} className="h-10 flex-1 rounded-lg bg-white text-xs font-semibold text-slate-700 ring-1 ring-slate-200">Keep</button>
                    <button type="button" onClick={() => { onClear(); switchShopFranchise(f.slug); }} className="h-10 flex-1 rounded-lg bg-[#E8431A] text-xs font-semibold text-white">Switch</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ZoneSheet({ onClose, onPlace, cartCount = 0, onClearCart }) {
  const profile = readProfile();
  const [pin, setPin] = useState(profile.lat != null && profile.lng != null ? { lat: profile.lat, lng: profile.lng } : null);

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

  const done = () => {
    saveProfile({ ...(pin ? { lat: pin.lat, lng: pin.lng } : {}) });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col bg-slate-50 sm:border-x sm:border-slate-200" role="dialog" aria-modal="true" aria-label="Delivery location">
      <AppBar title="Delivery location" onBack={done} />
      <div className="flex-1 overflow-y-auto p-4">
        <LocationPicker
          shop={null}
          hideCharge
          pin={pin}
          onChange={(next) => {
            setPin(next);
            saveProfile({ lat: next.lat, lng: next.lng });
          }}
        />
        <FranchiseList pin={pin} cartCount={cartCount} onClear={() => onClearCart?.()} />
      </div>
      <div className="border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <button type="button" onClick={done} className="h-12 w-full rounded-lg bg-[#E8431A] text-base font-bold text-white active:scale-[0.98]">
          Done
        </button>
      </div>
    </div>
  );
}
