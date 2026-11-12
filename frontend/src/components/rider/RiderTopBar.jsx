import { Loader2, LogOut, Power, Wifi, WifiOff } from "lucide-react";
import { inr } from "../../utils/format.js";

function ProgressBar({ label, value, max, right, tone }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-medium">
        <span className="text-slate-600">{label}</span>
        <span className="text-slate-900">{right}</span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RiderTopBar({
  name,
  status,
  connected,
  toggling,
  onToggleOnline,
  onSignOut,
}) {
  const rider = status?.rider;
  const milestone = status?.milestone;
  const cash = Number(rider?.cash_in_hand ?? 0);
  const limit = Number(rider?.max_cash_limit ?? 1500);
  const cashRatio = limit > 0 ? cash / limit : 0;
  const cashTone = cashRatio >= 0.9 ? "bg-red-500" : cashRatio >= 0.7 ? "bg-amber-500" : "bg-green-500";
  const online = Boolean(rider?.is_online);

  return (
    <header className="sticky top-0 z-20 space-y-3 bg-white/95 px-4 pb-3 pt-3 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">{name}</h1>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            {connected ? (
              <Wifi className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-red-500" />
            )}
            {connected ? "Live" : "Reconnecting…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={online}
            onClick={onToggleOnline}
            disabled={toggling || !rider}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white shadow transition active:scale-95 disabled:opacity-60 ${
              online ? "bg-green-600" : "bg-slate-500"
            }`}
          >
            {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            {online ? "Online" : "Offline"}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>

      {rider && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ProgressBar
            label="Cash in hand"
            value={cash}
            max={limit}
            right={`${inr(cash)} / ${inr(limit)}`}
            tone={cashTone}
          />
          <ProgressBar
            label={`Daily milestone · ${inr(milestone.bonus)} bonus`}
            value={milestone.delivered_today}
            max={milestone.target}
            right={`${milestone.delivered_today} / ${milestone.target}`}
            tone="bg-orange-500"
          />
        </div>
      )}
    </header>
  );
}
