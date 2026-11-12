import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

// Emoji pins: Leaflet's default PNG icons do not survive bundling.
const pin = (emoji) =>
  L.divIcon({
    html: `<div style="font-size:26px;line-height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">${emoji}</div>`,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 24],
  });
const ICONS = { shop: pin("🏪"), home: pin("🏠"), rider: pin("🛵") };

function FitBounds({ points }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 16);
    else if (points.length > 1) map.fitBounds(points, { padding: [32, 32], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

const toPoint = (lat, lng) =>
  lat != null && lng != null && Number.isFinite(Number(lat)) ? [Number(lat), Number(lng)] : null;

/** Leaflet / OpenStreetMap view: shop, customer gate, and the live rider. */
export default function RouteMap({ order, riderPosition }) {
  const shop = toPoint(order.pickup_lat, order.pickup_lng);
  const drop = toPoint(order.drop_lat, order.drop_lng);
  const rider = riderPosition ? [riderPosition.lat, riderPosition.lng] : null;

  const points = [shop, drop, rider].filter(Boolean);
  const guideFrom = rider || shop;
  const center = points[0] || [11.0, 76.0];

  return (
    <div className="space-y-2">
      <div className="h-56 overflow-hidden rounded-xl ring-1 ring-slate-200">
        <MapContainer center={center} zoom={15} scrollWheelZoom={false} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={points} />
          {shop && (
            <Marker position={shop} icon={ICONS.shop}>
              <Popup>{order.shop_name ?? "Pickup"}</Popup>
            </Marker>
          )}
          {drop && (
            <Marker position={drop} icon={ICONS.home}>
              <Popup>{order.turning_point || "Customer"}</Popup>
            </Marker>
          )}
          {rider && <Marker position={rider} icon={ICONS.rider} />}
          {guideFrom && drop && (
            <Polyline positions={[guideFrom, drop]} pathOptions={{ color: "#ea580c", weight: 4, dashArray: "8 8" }} />
          )}
        </MapContainer>
      </div>
      {drop ? (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${drop[0]},${drop[1]}&travelmode=two-wheeler`}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-xl bg-blue-50 py-2.5 text-center text-sm font-semibold text-blue-700"
        >
          🧭 Open turn-by-turn navigation
        </a>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
          Customer location not shared yet — send the Magic Link.
        </p>
      )}
    </div>
  );
}
