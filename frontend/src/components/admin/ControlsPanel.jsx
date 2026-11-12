import { CloudRain, Loader2, Rocket } from "lucide-react";
import { useState } from "react";
import api, { getErrorMessage } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-60 ${checked ? "bg-green-500" : "bg-slate-300"}`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-7" : "left-1"}`} />
    </button>
  );
}

export default function ControlsPanel({ franchise, onUpdated, toast }) {
  const [busy, setBusy] = useState(null);
  const surgeOn = Number(franchise.rain_surge_fee) > 0;
  const [surgeAmount, setSurgeAmount] = useState(surgeOn ? franchise.rain_surge_fee : "20");

  async function save(field, patch, message) {
    setBusy(field);
    try {
      const { data } = await api.patch("/admin/franchise/settings", patch);
      onUpdated(data.data.franchise);
      toast(message(data.data.franchise), "success");
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 font-bold">
              <Rocket className="h-5 w-5 text-orange-600" /> Launch Promo
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Rider gets 100% of the delivery fee. Franchise keeps vendor commission + shop markup, minus royalty.
            </p>
          </div>
          {busy === "promo" ? (
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          ) : (
            <Switch
              label="Launch promo"
              checked={franchise.is_launch_promo_active}
              onChange={(value) =>
                save("promo", { is_launch_promo_active: value }, (f) =>
                  f.is_launch_promo_active ? "🚀 Launch promo ON" : "Launch promo OFF"
                )
              }
            />
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">Applies to orders picked up from now on.</p>
      </section>

      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 font-bold">
              <CloudRain className="h-5 w-5 text-blue-600" /> Rain Surge
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Adds a fixed amount to every order at pickup, 100% to the rider. Charged once per order.
            </p>
          </div>
          {busy === "surge" ? (
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          ) : (
            <Switch
              label="Rain surge"
              checked={surgeOn}
              onChange={(value) =>
                save("surge", { rain_surge_fee: value ? String(surgeAmount || 20) : "0" }, (f) =>
                  Number(f.rain_surge_fee) > 0 ? `🌧️ Rain surge ON: +${inr(f.rain_surge_fee)}` : "Rain surge OFF"
                )
              }
            />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {["10", "20", "30"].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSurgeAmount(value)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                Number(surgeAmount) === Number(value) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"
              }`}
            >
              ₹{value}
            </button>
          ))}
          <input
            type="number"
            inputMode="decimal"
            min="1"
            max="200"
            aria-label="Custom surge amount"
            value={surgeAmount}
            onChange={(e) => setSurgeAmount(e.target.value)}
            className="w-24 rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          {surgeOn && Number(surgeAmount) !== Number(franchise.rain_surge_fee) && (
            <button
              type="button"
              onClick={() =>
                save("surge", { rain_surge_fee: String(surgeAmount) }, (f) => `Rain surge now +${inr(f.rain_surge_fee)}`)
              }
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white"
            >
              Update
            </button>
          )}
        </div>
        <p className="mt-2 text-sm font-semibold">
          Now: {surgeOn ? <span className="text-blue-700">ON · +{inr(franchise.rain_surge_fee)}</span> : <span className="text-slate-500">OFF</span>}
        </p>
      </section>
    </div>
  );
}
