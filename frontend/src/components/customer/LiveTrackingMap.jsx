import L from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { GATE_GAP_METRES, ROUTE_STYLE, metresBetween, remainingRoute } from "../../utils/route.js";

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

/**
 * The bike glides to each new position, and the line in front of it follows
 * the road (when the server sent a route) or falls back to a straight dashed
 * line. The road line shortens as the rider moves along it.
 */
function BikeAndRoute({ position, home, route }) {
  const map = useMap();
  const marker = useRef(null);
  const layers = useRef(null);
  const frame = useRef(0);
  const fitted = useRef(false);
  const current = useRef(null); // the bike's animated [lat, lng]
  const routeRef = useRef(route);
  routeRef.current = route;

  function ensureLayers() {
    if (!layers.current) {
      layers.current = {
        casing: L.polyline([], ROUTE_STYLE.casing),
        line: L.polyline([], ROUTE_STYLE.line),
        flow: L.polyline([], ROUTE_STYLE.flow),
        walk: L.polyline([], ROUTE_STYLE.walk),
        approach: L.polyline([], ROUTE_STYLE.walk),
        straight: L.polyline([], ROUTE_STYLE.straight),
      };
      for (const layer of Object.values(layers.current)) layer.addTo(map);
    }
    return layers.current;
  }

  function draw() {
    if (!home) return;
    const l = ensureLayers();
    const from = current.current;
    const ahead = remainingRoute(routeRef.current, from);

    if (ahead) {
      l.casing.setLatLngs(ahead.coords);
      l.line.setLatLngs(ahead.coords);
      l.flow.setLatLngs(ahead.coords);
      l.straight.setLatLngs([]);
      // Rider is off the mapped road (lane, yard, GPS drift): dashed link to it.
      l.approach.setLatLngs(from && ahead.offRoute >= GATE_GAP_METRES ? [from, ahead.coords[0]] : []);
      // The road often stops short of a rural house: dashed walk to the gate.
      const end = ahead.coords[ahead.coords.length - 1];
      const homePoint = [home.lat ?? home[0], home.lng ?? home[1]];
      l.walk.setLatLngs(metresBetween(end, homePoint) >= GATE_GAP_METRES ? [end, homePoint] : []);
    } else {
      for (const key of ["casing", "line", "flow", "walk", "approach"]) l[key].setLatLngs([]);
      l.straight.setLatLngs(from ? [from, home] : []);
    }
  }

  // Bike movement.
  useEffect(() => {
    if (!position) return undefined;
    const target = L.latLng(position[0], position[1]);
    if (!marker.current) {
      marker.current = L.marker(target, { icon: BIKE, zIndexOffset: 1000 }).addTo(map);
    }
    if (!fitted.current) {
      fitted.current = true;
      const bounds = L.latLngBounds([target]);
      if (home) bounds.extend(home);
      for (const c of routeRef.current?.coords ?? []) bounds.extend(c);
      if (bounds.isValid() && home) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      else map.setView(target, 16);
    }

    const start = marker.current.getLatLng();
    const began = performance.now();
    cancelAnimationFrame(frame.current);
    const step = (now) => {
      const t = Math.min(1, (now - began) / ANIMATION_MS);
      const eased = t * (2 - t);
      const lat = start.lat + (target.lat - start.lat) * eased;
      const lng = start.lng + (target.lng - start.lng) * eased;
      marker.current.setLatLng([lat, lng]);
      current.current = [lat, lng];
      draw();
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
    // draw() reads the latest route/home through refs and props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, home, map]);

  // A new route (rider took another road, customer re-pinned) redraws at once.
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, home]);

  useEffect(
    () => () => {
      // Clear the refs too: React may remount this component (StrictMode),
      // and the next render must create fresh layers on the map.
      marker.current?.remove();
      for (const layer of Object.values(layers.current ?? {})) layer.remove();
      marker.current = null;
      layers.current = null;
      current.current = null;
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

export default function LiveTrackingMap({ home, bike, route }) {
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
        <BikeAndRoute position={bike} home={home} route={route} />
      </MapContainer>
    </div>
  );
}
