import L from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { inr } from "../../utils/format.js";

const STALE_MS = 10 * 60 * 1000;

function riderState(rider) {
  if (!rider.is_online) return { color: "#64748b", label: "Offline" };
  if (rider.active_orders > 0) return { color: "#ea580c", label: `On delivery (${rider.active_orders})` };
  return { color: "#16a34a", label: "Online · free" };
}

function riderIcon(rider) {
  const { color } = riderState(rider);
  const stale = !rider.last_location_at || Date.now() - new Date(rider.last_location_at) > STALE_MS;
  const name = rider.name.replace(/[<>&"]/g, "");
  return L.divIcon({
    className: "",
    iconSize: [90, 44],
    iconAnchor: [45, 40],
    html: `<div style="display:flex;flex-direction:column;align-items:center;opacity:${stale ? 0.5 : 1}">
      <span style="background:${color};color:#fff;font:600 11px Inter,sans-serif;padding:1px 6px;border-radius:9999px;white-space:nowrap">${name}</span>
      <span style="font-size:24px;line-height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">🛵</span>
    </div>`,
  });
}

function FitOnce({ points }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
  }, [points, map]);
  return null;
}

export default function FleetRadar({ riders, openRequests, connected }) {
  const located = riders.filter((r) => r.lat != null && r.lng != null);
  const points = located.map((r) => [Number(r.lat), Number(r.lng)]);
  const online = riders.filter((r) => r.is_online).length;
  const busy = riders.filter((r) => r.active_orders > 0).length;
  const deliveredToday = riders.reduce((sum, r) => sum + r.delivered_today, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Riders online" value={`${online}/${riders.length}`} />
        <Stat label="On delivery" value={busy} />
        <Stat label="Waiting orders" value={openRequests} warn={openRequests > 0} />
        <Stat label="Delivered today" value={deliveredToday} />
      </div>

      <div className="relative h-[22rem] overflow-hidden rounded-2xl ring-1 ring-slate-200 sm:h-[28rem]">
        <MapContainer center={points[0] || [11.0, 76.0]} zoom={14} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitOnce points={points} />
          {located.map((rider) => (
            <Marker key={rider.id} position={[Number(rider.lat), Number(rider.lng)]} icon={riderIcon(rider)}>
              <Popup>
                <strong>{rider.name}</strong>
                <br />
                {riderState(rider).label}
                <br />
                Cash {inr(rider.cash_in_hand)} · {rider.delivered_today} today
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        <span
          className={`absolute right-2 top-2 z-[400] rounded-full px-2.5 py-1 text-xs font-semibold shadow ${
            connected ? "bg-green-600 text-white" : "bg-slate-700 text-white"
          }`}
        >
          {connected ? "● Live radar" : "Reconnecting…"}
        </span>
        {located.length === 0 && (
          <p className="absolute inset-x-4 bottom-4 z-[400] rounded-xl bg-white/95 p-3 text-center text-sm text-slate-600 shadow">
            No rider positions yet. Riders appear here once they go online with GPS on.
          </p>
        )}
      </div>

      <ul className="divide-y overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {riders.map((rider) => {
          const state = riderState(rider);
          return (
            <li key={rider.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{rider.name}</p>
                <p className="text-xs text-slate-500">
                  {rider.vehicle_number} ·{" "}
                  {rider.last_location_at
                    ? `seen ${new Date(rider.last_location_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                    : "no GPS yet"}
                </p>
              </div>
              <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: state.color }}>
                {state.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div className={`rounded-2xl p-3 ring-1 ${warn ? "bg-amber-50 ring-amber-200" : "bg-white ring-slate-200"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-extrabold">{value}</p>
    </div>
  );
}
