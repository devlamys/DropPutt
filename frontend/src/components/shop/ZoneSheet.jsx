import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchPlaceName } from "../../utils/place.js";
import { inr } from "../../utils/format.js";
import Modal from "../Modal.jsx";
import LocationPicker from "./LocationPicker.jsx";
import { readProfile, saveProfile } from "./StorefrontContext.jsx";

/**
 * "Where should we deliver?" Use the current location, search a place or type an
 * address, and drag the pin to the exact house. The place is remembered on this
 * phone and pre-fills every order form; the charge is worked out from it. The
 * distance bands are listed underneath for anyone who only wants the prices.
 */
export default function ZoneSheet({ zones, onClose, onPlace }) {
  const profile = readProfile();
  const [pin, setPin] = useState(profile.lat != null && profile.lng != null ? { lat: profile.lat, lng: profile.lng } : null);
  const [address, setAddress] = useState(profile.address || "");
  let from = 0;

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
    saveProfile({ address: address.trim(), ...(pin ? { lat: pin.lat, lng: pin.lng } : {}) });
    onClose();
  };

  return (
    <Modal title="Delivery location & charges" onClose={done}>
      <p className="-mt-2 mb-3 text-sm text-slate-500">Share where you are, or search and drag the pin to your house. We remember it for your next order.</p>
      <LocationPicker
        shop={null}
        pin={pin}
        onChange={(next) => {
          setPin(next);
          saveProfile({ lat: next.lat, lng: next.lng });
        }}
      />
      <label className="mt-3 block text-sm font-semibold text-slate-700" htmlFor="home-address">Address • വിലാസം</label>
      <textarea
        id="home-address"
        rows={2}
        maxLength={300}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="House name, nearest landmark"
        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none placeholder:text-slate-400 focus:border-flame-500 focus:ring-4 focus:ring-flame-100"
      />
      <button type="button" onClick={done} className="mt-3 h-12 w-full rounded-lg bg-[#E8431A] text-base font-bold text-white active:scale-[0.98]">
        Done
      </button>

      <h3 className="mb-2 mt-5 text-sm font-bold text-slate-700">Charges by distance</h3>
      <ul className="space-y-2">
        {zones.map((zone) => {
          const upTo = Number(zone.max_km);
          const label = `${from}–${upTo} km`;
          from = upTo;
          return (
            <li key={zone.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <MapPin className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1 font-semibold">{label}</span>
              <span className="shrink-0 text-sm font-bold">{inr(zone.delivery_fee)}</span>
            </li>
          );
        })}
      </ul>
      {zones.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Delivery charges are being set up.</p>}
    </Modal>
  );
}
