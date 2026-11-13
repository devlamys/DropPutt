import { Building2, Gauge, Loader2, LogOut, Radar, Receipt, Settings2, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ControlsPanel from "../components/admin/ControlsPanel.jsx";
import FleetRadar from "../components/admin/FleetRadar.jsx";
import FranchisesPanel from "../components/admin/FranchisesPanel.jsx";
import ReconciliationPanel from "../components/admin/ReconciliationPanel.jsx";
import SettlementLedger from "../components/admin/SettlementLedger.jsx";
import StuckOrders from "../components/admin/StuckOrders.jsx";
import WalletPassbook from "../components/admin/WalletPassbook.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSocket } from "../hooks/useSocket.js";
import api, { getActingSlug, getErrorMessage, setActingSlug } from "../utils/api.js";

const TABS = [
  { key: "radar", label: "Fleet Radar", icon: Radar },
  { key: "ledger", label: "Settlement", icon: Gauge },
  { key: "controls", label: "Promo & Surge", icon: Settings2 },
  { key: "wallet", label: "Wallet", icon: Wallet },
  { key: "reconcile", label: "Reconcile", icon: Receipt },
  { key: "franchises", label: "Franchises", icon: Building2, superOnly: true },
];

export default function AdminDashboard() {
  const { user, signOut } = useAuth();
  const { toast, node: toastNode } = useToast();
  const isSuper = user.role === "SUPER_ADMIN";
  const [franchises, setFranchises] = useState([]);
  const [slug, setSlug] = useState(isSuper ? null : "own");
  const [tab, setTab] = useState("radar");

  // The Super Admin works inside one franchise at a time (x-franchise-slug).
  const loadFranchises = useCallback(async () => {
    const { data } = await api.get("/super/franchises");
    const list = data.data.franchises;
    setFranchises(list);
    setSlug((current) => {
      const wanted = current || getActingSlug();
      const pick = list.find((f) => f.slug === wanted) ?? list[0];
      if (pick) setActingSlug(pick.slug);
      return pick?.slug ?? null;
    });
    return list;
  }, []);

  useEffect(() => {
    if (isSuper) loadFranchises().catch((error) => toast(getErrorMessage(error), "error"));
  }, [isSuper, loadFranchises, toast]);

  function selectFranchise(next) {
    setActingSlug(next);
    setSlug(next);
  }

  const tabs = TABS.filter((t) => !t.superOnly || isSuper);

  return (
    <div className="mx-auto min-h-screen max-w-5xl pb-24 sm:pb-10">
      {toastNode}
      <header className="sticky top-0 z-[500] bg-white/95 px-4 pt-3 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3 pb-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
              {isSuper ? "Super Admin" : "Franchise Admin"}
            </p>
            {isSuper ? (
              <select
                aria-label="Franchise"
                value={slug ?? ""}
                onChange={(e) => selectFranchise(e.target.value)}
                className="max-w-full truncate rounded-lg border border-slate-300 bg-white py-1 pl-2 pr-8 text-lg font-bold"
              >
                {franchises.map((f) => (
                  <option key={f.slug} value={f.slug}>
                    {f.name}
                    {f.is_active ? "" : " (suspended)"}
                  </option>
                ))}
              </select>
            ) : (
              <h1 className="truncate text-lg font-bold">{user.name}</h1>
            )}
          </div>
          <button type="button" onClick={signOut} aria-label="Sign out" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="hidden gap-1 sm:flex" aria-label="Sections">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold ${
                tab === key ? "border-orange-600 text-orange-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>
      </header>

      {slug ? (
        <FranchiseWorkspace
          key={slug}
          slug={slug === "own" ? null : slug}
          tab={tab}
          isSuper={isSuper}
          franchises={franchises}
          onSelectFranchise={selectFranchise}
          onFranchisesChanged={loadFranchises}
          toast={toast}
        />
      ) : (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}

      {/* bottom tab bar on phones */}
      <nav className="fixed inset-x-0 bottom-0 z-[500] grid border-t bg-white sm:hidden" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }} aria-label="Sections">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${tab === key ? "text-orange-600" : "text-slate-500"}`}
          >
            <Icon className="h-5 w-5" />
            {label.split(" ")[0]}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Everything for one franchise; remounted (fresh socket) when it changes. */
function FranchiseWorkspace({ slug, tab, isSuper, franchises, onSelectFranchise, onFranchisesChanged, toast }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/overview");
      setOverview(data.data);
      setError("");
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Coalesce bursts of order events into one reload.
  const reloadTimer = useRef(null);
  const scheduleReload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(load, 800);
  }, [load]);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  const patchRider = (riderId, patch) =>
    setOverview((current) =>
      current && {
        ...current,
        riders: current.riders.map((r) => (r.id === riderId ? { ...r, ...patch } : r)),
      }
    );

  const { connected } = useSocket(
    {
      fleet_rider_move: ({ rider_id, lat, lng, timestamp }) =>
        patchRider(rider_id, { lat, lng, last_location_at: new Date(timestamp).toISOString() }),
      fleet_rider_status: ({ rider_id, is_online }) => patchRider(rider_id, { is_online }),
      order_accepted: scheduleReload,
      order_delivered: scheduleReload,
      order_cancelled: scheduleReload,
      order_status_changed: scheduleReload, // new orders from the storefront
      stale_order_alert: ({ order_number, waiting_minutes }) => {
        toast(`⏳ Order #${order_number} has waited ${waiting_minutes} min — riders alerted again`, "warn");
        scheduleReload();
      },
      franchise_settings_changed: (settings) =>
        setOverview((current) => current && { ...current, franchise: { ...current.franchise, ...settings } }),
    },
    { auth: slug ? { franchise_slug: slug } : undefined }
  );

  // Safety net for missed events (e.g. new waiting orders).
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (error && !overview) {
    return <p className="m-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  }
  if (!overview) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const updateFranchise = (franchise) => setOverview((current) => ({ ...current, franchise }));

  return (
    <main className="px-4 pt-4">
      {tab === "radar" && (
        <>
          <StuckOrders orders={overview.stuck_orders} onChanged={load} toast={toast} />
          <FleetRadar riders={overview.riders} openRequests={overview.open_requests} connected={connected} />
        </>
      )}
      {tab === "ledger" && <SettlementLedger date={overview.date} riders={overview.riders} onSettled={load} toast={toast} />}
      {tab === "controls" && <ControlsPanel franchise={overview.franchise} onUpdated={updateFranchise} toast={toast} />}
      {tab === "wallet" && (
        <WalletPassbook
          franchise={overview.franchise}
          isSuperAdmin={isSuper}
          onChanged={() => {
            load();
            if (isSuper) onFranchisesChanged();
          }}
          toast={toast}
        />
      )}
      {tab === "reconcile" && <ReconciliationPanel toast={toast} />}
      {tab === "franchises" && isSuper && (
        <FranchisesPanel
          franchises={franchises}
          current={slug}
          onSelect={onSelectFranchise}
          onChanged={onFranchisesChanged}
          toast={toast}
        />
      )}
    </main>
  );
}
