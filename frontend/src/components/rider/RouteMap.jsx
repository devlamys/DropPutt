import L from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { GATE_GAP_METRES, ROUTE_STYLE, etaMinutes, formatDistance, metresBetween, remainingRoute } from "../../utils/route.js";

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

  const ahead = useMemo(() => remainingRoute(order.route, rider), [order.route, rider?.[0], rider?.[1]]);
  const roadEnd = ahead?.coords[ahead.coords.length - 1];
  const showWalk = ahead && drop && metresBetween(roadEnd, drop) >= GATE_GAP_METRES;
  const eta = ahead ? etaMinutes(order.route, ahead.metres) : null;

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
          {ahead ? (
            <>
              <Polyline positions={ahead.coords} pathOptions={ROUTE_STYLE.casing} />
              <Polyline positions={ahead.coords} pathOptions={ROUTE_STYLE.line} />
              <Polyline positions={ahead.coords} pathOptions={ROUTE_STYLE.flow} />
              {showWalk && <Polyline positions={[roadEnd, drop]} pathOptions={ROUTE_STYLE.walk} />}
              {rider && ahead.offRoute >= GATE_GAP_METRES && (
                <Polyline positions={[rider, ahead.coords[0]]} pathOptions={ROUTE_STYLE.walk} />
              )}
            </>
          ) : (
            guideFrom &&
            drop && <Polyline positions={[guideFrom, drop]} pathOptions={ROUTE_STYLE.straight} />
          )}
        </MapContainer>
      </div>
      {eta && (
        <p className="text-center text-sm font-semibold text-slate-700">
          {formatDistance(ahead.metres)} by road · about {eta} min
          {showWalk && <span className="font-normal text-slate-500"> · last {formatDistance(metresBetween(roadEnd, drop))} off-road</span>}
        </p>
      )}
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
