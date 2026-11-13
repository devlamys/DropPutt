#!/usr/bin/env bash
# Builds (or refreshes) the road-routing data for the `osrm` service.
#
#   deploy/osrm/build.sh malappuram     # Malappuram district + ~5 km around it (smallest)
#   deploy/osrm/build.sh kerala         # the whole state
#   deploy/osrm/build.sh southern       # all of Geofabrik's India southern zone (largest)
#
# Then (first time):  docker compose -f docker-compose.prod.yml --env-file deploy/compose.env --profile routing up -d osrm
# Refresh (monthly):  re-run this script; it restarts a running `osrm` container itself.
#
# What it does:
#   1. downloads the southern-zone OSM extract (only if Geofabrik has a newer one)
#   2. clips it to the region (osmium)
#   3. runs osrm-extract / osrm-partition / osrm-customize into a NEW folder
#   4. starts a throw-away OSRM on that folder and checks a known route
#   5. only then points ./osrm-data/current at it, and restarts the osrm service
# A failed build never touches the data the live server is using.
#
# Needs: docker, curl, osmium-tool (sudo apt install -y osmium-tool), ~2 GB disk.
# RAM: osrm-extract is the hungry step. Watch it with `docker stats` the first time.
#
# Settings (environment variables):
#   OSRM_DATA_DIR   where data lives            (default: <repo>/osrm-data)
#   OSRM_IMAGE      OSRM docker image           (default below — pin a tested version)
#   OSRM_PROFILE    car | bicycle | foot | /abs/path/custom.lua   (default: car)
#   OSRM_KEEP       old builds to keep for rollback (default: 2)
#   TEST_ROUTE      "lng,lat;lng,lat" that must route inside the region
#                   (default: Kizhissery, Malappuram)
#   OSRM_SOURCE_URL another Geofabrik .osm.pbf (e.g. a different India zone)

set -euo pipefail

REGION="${1:-}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="${OSRM_DATA_DIR:-$REPO_DIR/osrm-data}"
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v5.27.1}"
PROFILE="${OSRM_PROFILE:-car}"
KEEP="${OSRM_KEEP:-2}"
TEST_ROUTE="${TEST_ROUTE:-75.9982,11.1786;75.9905,11.1655}"
SOURCE_URL="${OSRM_SOURCE_URL:-https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf}"

log() { printf '\n[osrm] %s\n' "$*"; }
die() { printf '\n[osrm] ERROR: %s\n' "$*" >&2; exit 1; }

# ── region → how to clip ─────────────────────────────────────────────────────
# OSM relation ids: Malappuram district 2018186, Kerala 2018151.
case "$REGION" in
  malappuram)
    # District bounding box plus ~5 km, so roads just over the border still route.
    CLIP=(-b 75.78,10.64,76.60,11.57) ;;
  kerala)
    CLIP=(-p "$DATA_DIR/raw/kerala.poly") ;;
  southern)
    CLIP=() ;;
  *)
    sed -n '2,8p' "$0"; die "choose a region: malappuram | kerala | southern" ;;
esac

# ── checks ───────────────────────────────────────────────────────────────────
command -v docker >/dev/null || die "docker is not installed"
command -v curl >/dev/null || die "curl is not installed"
if [ ${#CLIP[@]} -gt 0 ]; then
  command -v osmium >/dev/null || die "osmium is not installed:  sudo apt install -y osmium-tool"
fi
case "$PROFILE" in
  car|bicycle|foot) PROFILE_IN_CONTAINER="/opt/$PROFILE.lua"; PROFILE_MOUNT=() ;;
  /*.lua)
    [ -f "$PROFILE" ] || die "profile not found: $PROFILE"
    PROFILE_IN_CONTAINER="/profile/$(basename "$PROFILE")"
    PROFILE_MOUNT=(-v "$(dirname "$PROFILE"):/profile:ro") ;;
  *) die "OSRM_PROFILE must be car, bicycle, foot or an absolute path to a .lua file" ;;
esac

mkdir -p "$DATA_DIR/raw"
STAMP="$(date +%Y%m%d-%H%M%S)"
BUILD="build-$STAMP-$REGION"
WORK="$DATA_DIR/$BUILD"
mkdir -p "$WORK"
TEST_NAME="osrm-test-$STAMP"
cleanup() {
  docker rm -f "$TEST_NAME" >/dev/null 2>&1 || true
  # A build that never went live is removed; the current one is untouched.
  if [ "${PROMOTED:-no}" != "yes" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

# ── 1. download (conditional: skipped when the local copy is up to date) ─────
SRC="$DATA_DIR/raw/$(basename "$SOURCE_URL")"
log "1/5 Downloading southern zone (≈ 530 MB, only if Geofabrik has newer data)…"
if [ -f "$SRC" ]; then
  curl -fL --retry 3 -z "$SRC" -o "$SRC.part" "$SOURCE_URL"
  if [ -s "$SRC.part" ]; then mv "$SRC.part" "$SRC"; else rm -f "$SRC.part"; echo "     already up to date"; fi
else
  curl -fL --retry 3 -o "$SRC.part" "$SOURCE_URL"
  mv "$SRC.part" "$SRC"
fi

# ── 2. clip ──────────────────────────────────────────────────────────────────
if [ "$REGION" = kerala ] && [ ! -s "$DATA_DIR/raw/kerala.poly" ]; then
  log "     Fetching the Kerala boundary polygon…"
  curl -fsSL -o "$DATA_DIR/raw/kerala.poly" \
    "https://polygons.openstreetmap.fr/get_poly.py?id=2018151&params=0"
  head -1 "$DATA_DIR/raw/kerala.poly" | grep -q . || die "empty Kerala polygon"
fi
if [ ${#CLIP[@]} -gt 0 ]; then
  log "2/5 Clipping to $REGION…"
  # smart: roads that cross the edge are kept whole instead of cut in half.
  osmium extract "${CLIP[@]}" --strategy smart --overwrite "$SRC" -o "$WORK/region.osm.pbf"
else
  log "2/5 No clipping (whole southern zone)…"
  cp "$SRC" "$WORK/region.osm.pbf"
fi
echo "     $(du -h "$WORK/region.osm.pbf" | cut -f1) of map data"

# ── 3. process ───────────────────────────────────────────────────────────────
run() { docker run --rm -t -v "$WORK:/data" "${PROFILE_MOUNT[@]}" "$IMAGE" "$@"; }
log "3/5 osrm-extract (profile: $PROFILE) — the step that needs the most RAM…"
run osrm-extract -p "$PROFILE_IN_CONTAINER" /data/region.osm.pbf
log "    osrm-partition…"
run osrm-partition /data/region.osrm
log "    osrm-customize…"
run osrm-customize /data/region.osrm
rm -f "$WORK/region.osm.pbf" # not needed by the server; the raw download stays

# ── 4. smoke test on a throw-away server ─────────────────────────────────────
log "4/5 Testing a route ($TEST_ROUTE)…"
docker run -d --name "$TEST_NAME" -v "$WORK:/data:ro" -p 127.0.0.1::5000 "$IMAGE" \
  osrm-routed --algorithm mld /data/region.osrm >/dev/null
PORT="$(docker port "$TEST_NAME" 5000/tcp | head -1 | sed 's/.*://')"
ok=no
for _ in $(seq 1 30); do
  if body="$(curl -fsS "http://127.0.0.1:$PORT/route/v1/driving/$TEST_ROUTE?overview=false" 2>/dev/null)"; then
    if printf '%s' "$body" | grep -q '"code":"Ok"'; then ok=yes; break; fi
  fi
  sleep 1
done
[ "$ok" = yes ] || die "test route failed — the live data was NOT changed. Server log:
$(docker logs --tail 20 "$TEST_NAME" 2>&1)"
distance="$(printf '%s' "$body" | grep -o '"distance":[0-9.]*' | head -1 | cut -d: -f2)"
echo "     OK — test route is ${distance:-?} m by road"
docker rm -f "$TEST_NAME" >/dev/null

# ── 5. go live ───────────────────────────────────────────────────────────────
log "5/5 Switching $DATA_DIR/current → $BUILD"
ln -sfn "$BUILD" "$DATA_DIR/current.new"
mv -Tf "$DATA_DIR/current.new" "$DATA_DIR/current"   # atomic rename
PROMOTED=yes

# Keep the newest $KEEP builds for rollback (`ln -sfn <older build> current`).
ls -1dt "$DATA_DIR"/build-* 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ "$(readlink "$DATA_DIR/current")" = "$(basename "$old")" ] || rm -rf "$old"
done

live="$(docker ps -q --filter label=com.docker.compose.service=osrm)"
if [ -n "$live" ]; then
  log "Restarting the running osrm service (routes fall back to straight lines for a few seconds)…"
  docker restart $live >/dev/null
else
  log "No osrm service running yet. Start it with:
  docker compose -f docker-compose.prod.yml --env-file deploy/compose.env --profile routing up -d osrm
and set ROUTING_URL=http://osrm:5000 in deploy/api.env (then restart api)."
fi
log "Done: $REGION ($BUILD)."
