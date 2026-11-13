# Deploying DropPutt

One server running Docker Compose is enough to start: Nginx (TLS + the React
app), the API, PostgreSQL, Redis, and a nightly backup job.

```
Internet ─▶ Nginx :443 ─┬─▶ static React app
 (*.techkerala.in)      ├─▶ /api, /health, /ready ─▶ api (Node) ─▶ PostgreSQL
                        └─▶ /socket.io (WebSocket) ┘            └▶ Redis
                                                    media ─▶ Cloudflare R2
                                                    push  ─▶ Firebase FCM
```

**Size:** 2 vCPU / 2 GB RAM / 25 GB disk runs one franchise comfortably.

## 1. Before you start

| Need | Notes |
|---|---|
| A server with Docker + Compose v2 | Ubuntu 22.04/24.04. Open ports 80 and 443. |
| A domain | e.g. `techkerala.in`. |
| DNS | `A  techkerala.in → server IP` and `A  *.techkerala.in → server IP` (wildcard covers every franchise and `admin.`). |
| A wildcard TLS certificate | See step 3. |
| Cloudflare R2 bucket | Bill photos, voice notes, gate photos. Create an API token with read/write on that bucket. |
| Firebase project (optional at first) | Push notifications. Without it push is a logged no-op. |

## 2. Configure

```bash
cp deploy/compose.env.example deploy/compose.env
cp deploy/api.env.example     deploy/api.env
```

Edit both. Generate secrets with:

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD (letters+digits only: it goes in a URL)
openssl rand -hex 48   # JWT_SECRET
```

Set `TRUST_PROXY` correctly: `1` with Nginx only, `2` if Cloudflare's proxy is
also in front. A wrong value makes every visitor share one IP for rate limits.

## 3. TLS certificate (wildcard)

Nginx reads `deploy/certs/fullchain.pem` and `deploy/certs/privkey.pem`.
A wildcard needs a DNS challenge. Pick one:

* **Let's Encrypt + certbot DNS-01** (free, renews):
  `certbot certonly --manual --preferred-challenges dns -d techkerala.in -d '*.techkerala.in'`
  (or a DNS-provider plugin for automatic renewal), then copy the two files
  into `deploy/certs/` and run `docker compose ... restart web` after each renewal.
* **Cloudflare Origin Certificate** (15-year, free) if the domain is proxied
  through Cloudflare with SSL mode *Full (strict)*. Download the PEM pair into
  `deploy/certs/` as the two file names above.

## 4. Optional integrations

* **Firebase push:** download the service-account JSON to
  `deploy/secrets/firebase.json` (never commit it).
* **R2:** fill the `R2_*` values in `deploy/api.env`. Without R2 in production
  uploads have nowhere to go, so set it before real use.
* **Road routes on the maps (OSRM):** without it the maps draw a straight
  dashed line from rider to house. To turn it on:

  ```bash
  sudo apt install -y osmium-tool
  deploy/osrm/build.sh malappuram          # later: kerala, or southern
  docker compose -f docker-compose.prod.yml --env-file deploy/compose.env --profile routing up -d osrm
  ```

  then set `ROUTING_URL=http://osrm:5000` in `deploy/api.env` and
  `docker compose … up -d api`. The script downloads OpenStreetMap data,
  clips it to the region, builds into a new folder, test-routes it, and only
  then switches `osrm-data/current` — a failed build never affects the live
  server. **Refresh monthly** by re-running the script (it restarts `osrm`), so
  roads added to OpenStreetMap reach the app. Rollback:
  `ln -sfn <older build-…> osrm-data/current` and restart `osrm`. Watch the
  first build with `docker stats`; `osrm-extract` needs the most memory.
  Never point `ROUTING_URL` at a public demo server.

## 5. First start

```bash
docker compose -f docker-compose.prod.yml --env-file deploy/compose.env up -d --build
docker compose -f docker-compose.prod.yml --env-file deploy/compose.env ps
```

The `migrate` service applies database migrations and exits; the API starts
after it succeeds. Check readiness:

```bash
curl -s https://techkerala.in/ready     # {"success":true,"data":{"status":"ready",...}}
```

Create the Super Admin (the demo seed is **not** for production):

```bash
docker compose -f docker-compose.prod.yml --env-file deploy/compose.env run --rm \
  -e SUPER_ADMIN_PHONE=9XXXXXXXXX -e SUPER_ADMIN_NAME="Your Name" \
  api node scripts/create-super-admin.mjs
```

It asks for a PIN (6 to 12 characters). Then:

1. Open `https://admin.techkerala.in`, sign in with that phone and PIN.
2. **Franchises → create** your first franchise (name, slug, royalty, admin login,
   opening wallet balance). Its site is `https://<slug>.techkerala.in`.
3. Sign in as that franchise admin, add vendors/riders through your onboarding
   process, and top up the royalty wallet from the Super Admin Wallet tab.

## 6. Smoke test checklist

- [ ] `https://<slug>.techkerala.in/shop` loads on a phone.
- [ ] `http://…` redirects to `https://`.
- [ ] Vendor login → "Call Rider" → an online rider's phone alarm rings.
- [ ] Rider accepts → customer's Magic Link page shows the rider and bill.
- [ ] Customer taps **Share My Current Location** (needs HTTPS) and records a voice note.
- [ ] Delivery completes; Admin → **Reconcile** shows a green banner.
- [ ] `docker compose … logs api` shows JSON `audit` lines for the money events.

## 7. Operating

**Logs:** `docker compose -f docker-compose.prod.yml logs -f api`
(structured JSON; financial events are `"level":"audit"`).

**Update to a new release**

```bash
git pull
# take a backup first (migrations only go forward):
docker compose -f docker-compose.prod.yml --env-file deploy/compose.env exec backup sh /backup.sh
APP_VERSION=2026-11-20 docker compose -f docker-compose.prod.yml --env-file deploy/compose.env up -d --build
```

Set `APP_VERSION` in `deploy/compose.env` per release. To roll back the code,
re-run `up -d` with the previous `APP_VERSION`. A migration that already ran is
not undone: restore the backup if a release's migration must be reverted.

**Backups:** the `backup` service writes `./backups/dropputt-<time>.sql.gz` nightly
and keeps `BACKUP_KEEP_DAYS`. **Copy them off the server** (R2/S3, another host).

Restore into an empty database:

```bash
gunzip -c backups/dropputt-YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U dropputt -d dropputt
```

**Scaling out:** `docker compose … up -d --scale api=3` then
`docker compose … restart web` (Nginx resolves replica addresses at start).
Redis carries Socket.io events between replicas, scheduled jobs take a database
run-once lock, and GPS replay protection is shared through Redis.

**Rate limits** are counted per API replica; with N replicas the effective
limit is up to N× the configured one.

**Monitoring:** point an uptime monitor at `https://techkerala.in/ready`
(returns 503 if the database or Redis is down).

## 8. Security checklist

- [ ] `deploy/compose.env`, `deploy/api.env`, `deploy/certs/*`, `deploy/secrets/*` are not in git.
- [ ] Firewall allows only 22 (SSH), 80, 443. PostgreSQL and Redis are not published.
- [ ] `JWT_SECRET` is random, 32+ characters, and not the development value.
- [ ] Super Admin PIN is as long as allowed (12 characters); change it with `create-super-admin.mjs --reset-pin`.
- [ ] Backups are copied off the server and a restore has been tried once.
- [ ] `TRUST_PROXY` matches your real proxy chain.
- [ ] Rider KYC documents (if stored) are in a **private** bucket path, never the public media domain.

## Local testing of the production images

Use a self-signed certificate and a `.localhost` domain:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost" \
  -keyout deploy/certs/privkey.pem -out deploy/certs/fullchain.pem
# DOMAIN=localhost in deploy/compose.env, then:
curl -k https://kizhissery.localhost/ready
```
