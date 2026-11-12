import L from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";

const pin = (emoji, size = 30) =>
  L.divIcon({
    html: `<div style="font-size:${size}px;line-height:${size}px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">${emoji}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
  });
const HOME = pin("🏠");
const BIKE = pin("🛵", 34);
const ANIMATION_MS = 4500; // just under the 5 s update interval

/** Bike marker that glides to each new position instead of jumping. */
function AnimatedBike({ position, home }) {
  const map = useMap();
  const marker = useRef(null);
  const line = useRef(null);
  const frame = useRef(0);
  const fitted = useRef(false);

  useEffect(() => {
    if (!position) return undefined;
    const target = L.latLng(position[0], position[1]);
    if (!marker.current) {
      marker.current = L.marker(target, { icon: BIKE, zIndexOffset: 1000 }).addTo(map);
    }
    if (!fitted.current) {
      fitted.current = true;
      if (home) map.fitBounds([target, home], { padding: [40, 40], maxZoom: 17 });
      else map.setView(target, 16);
    }

    const start = marker.current.getLatLng();
    const began = performance.now();
    cancelAnimationFrame(frame.current);
    const step = (now) => {
      const t = Math.min(1, (now - began) / ANIMATION_MS);
      const eased = t * (2 - t);
      const current = L.latLng(
        start.lat + (target.lat - start.lat) * eased,
        start.lng + (target.lng - start.lng) * eased
      );
      marker.current.setLatLng(current);
      if (home) {
        if (!line.current) {
          line.current = L.polyline([current, home], {
            color: "#ea580c",
            weight: 4,
            dashArray: "8 8",
          }).addTo(map);
        } else line.current.setLatLngs([current, home]);
      }
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [position, home, map]);

  useEffect(
    () => () => {
      // Clear the refs too: React may remount this component (StrictMode),
      // and the next position must create fresh layers on the map.
      marker.current?.remove();
      line.current?.remove();
      marker.current = null;
      line.current = null;
      fitted.current = false;
    },
    []
  );
  return null;
}

function CenterOnHome({ home, hasBike }) {
  const map = useMap();
  useEffect(() => {
    if (home && !hasBike) map.setView(home, 17);
  }, [home, hasBike, map]);
  return null;
}

export default function LiveTrackingMap({ home, bike }) {
  const center = bike || home || [11.0, 76.0];
  return (
    <div className="h-72 overflow-hidden rounded-2xl ring-1 ring-slate-200">
      <MapContainer center={center} zoom={15} scrollWheelZoom={false} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {home && <Marker position={home} icon={HOME} />}
        <CenterOnHome home={home} hasBike={Boolean(bike)} />
        <AnimatedBike position={bike} home={home} />
      </MapContainer>
    </div>
  );
}
