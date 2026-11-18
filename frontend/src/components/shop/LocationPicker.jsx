import L from "leaflet";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, LocateFixed, Search } from "lucide-react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import api, { getErrorMessage } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

const publicApi = { skipAuth: true };
const emoji = (symbol, size = 32) =>
  L.divIcon({
    html: `<div style="font-size:${size}px;line-height:${size}px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">${symbol}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
  });
const HOME = emoji("📍", 36);
const SHOP = emoji("🍽️", 28);

/** Moves the map to a place chosen by search, GPS or a saved pin. Taps and drags leave the view alone. */
function FlyTo({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], 16, { animate: true });
  }, [focus, map]);
  return null;
}

function TapToPlace({ onPick }) {
  useMapEvents({ click: (event) => onPick(event.latlng.lat, event.latlng.lng) });
  return null;
}

/**
 * Where should we deliver? One map: use your current location, search a place by
 * name, or tap / drag the pin. The delivery fee is shown as soon as the pin moves
 * (the software works out the zone from the distance; the customer never picks one).
 *
 * `shop`: { id, shop_name, lat, lng }. `pin`: { lat, lng } | null.
 * `onChange(pin, quote)` is called when the pin moves and again when its quote arrives.
 */
export default function LocationPicker({ shop, pin, onChange }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  // Where the map should fly to: set by search / GPS (and a saved pin), not by taps or drags.
  const [focus, setFocus] = useState(pin ? { lat: pin.lat, lng: pin.lng } : null);
  const latest = useRef(0);
  const shopPos = shop?.lat != null ? [shop.lat, shop.lng] : null;

  const place = useCallback(
    (lat, lng, { fly = false } = {}) => {
      if (fly) setFocus({ lat, lng });
      setPlaces(null);
      setNote("");
      setQuote(null);
      onChange({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }, null);
    },
    [onChange]
  );

  // Ask the server what delivery here costs, shortly after the pin stops moving.
  useEffect(() => {
    if (!pin) return undefined;
    const ticket = ++latest.current;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.post("/marketplace/delivery-quote", { ...(shop ? { vendor_id: shop.id } : {}), lat: pin.lat, lng: pin.lng }, publicApi);
        if (ticket !== latest.current) return;
        setQuote(data.data);
        onChange(pin, data.data);
      } catch (error) {
        if (ticket === latest.current) setNote(getErrorMessage(error, "Could not check the delivery charge."));
      } finally {
        if (ticket === latest.current) setQuoting(false);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.lat, pin?.lng, shop?.id]);

  function useMyLocation() {
    if (!("geolocation" in navigator)) return setNote("This phone cannot share its location. Search a place or tap the map.");
    setLocating(true);
    setNote("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        place(position.coords.latitude, position.coords.longitude, { fly: true });
      },
      (error) => {
        setLocating(false);
        setNote(
          error.code === 1
            ? "Location is blocked for this site. Allow it in the browser, or search a place and tap the map."
            : "Could not get your location. Search a place or tap the map."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }

  async function search(event) {
    event.preventDefault();
    if (query.trim().length < 3) return setNote("Type at least 3 letters of the place name.");
    setSearching(true);
    setNote("");
    try {
      const { data } = await api.get("/public/geocode", {
        ...publicApi,
        params: { q: query.trim(), ...(shopPos ? { near_lat: shopPos[0], near_lng: shopPos[1] } : {}) },
      });
      setPlaces(data.data.places);
      if (data.data.places.length === 0) setNote("No place found. Try another name, or tap the map.");
    } catch (error) {
      setNote(getErrorMessage(error, "Search is not available right now. Tap the map instead."));
    } finally {
      setSearching(false);
    }
  }

  const center = pin ? [pin.lat, pin.lng] : (shopPos ?? [11.0, 76.0]);
  const out = quote && !quote.deliverable;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={useMyLocation} disabled={locating} className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-[#E8431A] px-4 text-sm font-bold text-white disabled:opacity-60">
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          Share my current location
        </button>
      </div>

      <form onSubmit={search} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Or search a place (town, bus stand, landmark)"
          aria-label="Search a place"
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <button type="submit" disabled={searching} aria-label="Search" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white disabled:opacity-60">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </form>

      {places && places.length > 0 && (
        <ul className="max-h-40 divide-y overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm">
          {places.map((p) => (
            <li key={`${p.lat},${p.lng},${p.name}`}>
              <button type="button" onClick={() => place(p.lat, p.lng, { fly: true })} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="h-64 overflow-hidden rounded-xl ring-1 ring-slate-200">
        <MapContainer center={center} zoom={pin ? 16 : 14} scrollWheelZoom className="h-full w-full">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {shopPos && <Marker position={shopPos} icon={SHOP} interactive={false} />}
          {pin && (
            <Marker
              position={[pin.lat, pin.lng]}
              icon={HOME}
              draggable
              eventHandlers={{ dragend: (event) => place(event.target.getLatLng().lat, event.target.getLatLng().lng) }}
            />
          )}
          <TapToPlace onPick={place} />
          <FlyTo focus={focus} />
        </MapContainer>
      </div>

      <p className="text-xs text-slate-500">
        {pin ? "Drag the pin to your exact house." : "Tap the map where the delivery should come."}
      </p>

      {pin && (
        <p aria-live="polite" className={`rounded-xl px-3 py-2 text-sm font-semibold ${out ? "bg-red-50 text-red-700" : "bg-flame-50 text-flame-900"}`}>
          {quoting && !quote
            ? "Checking the delivery charge…"
            : out
              ? quote.message
              : quote
                ? `${quote.km} km${shop ? ` from ${shop.shop_name}` : ""} · Delivery ${inr(quote.delivery_fee)}`
                : ""}
        </p>
      )}
      {note && <p className="text-sm text-amber-700">{note}</p>}
    </div>
  );
}
