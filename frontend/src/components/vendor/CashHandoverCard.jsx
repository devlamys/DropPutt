import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

// Vendor side: one tap to confirm cash a rider says they paid, plus a
// shortcut to record cash received without waiting for the rider.
export default function CashHandoverCard({ reloadKey, toast }) {
  const [pending, setPending] = useState([]);
  const [riders, setRiders] = useState([]);
  const [open, setOpen] = useState(false);
  const [riderId, setRiderId] = useState("");
  const [amount, setAmount] = useState("");
  const [busyId, setBusyId] = useState(null);
  const key = useRef(null);

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        api.get("/vendor/cash-handovers", { params: { status: "PENDING" } }),
        api.get("/vendor/cash-riders"),
      ]);
      setPending(p.data.data.items);
      setRiders(r.data.data.items);
    } catch {
      /* the dashboard already reports connectivity problems */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (pending.length === 0 && riders.length === 0) return null;

  async function resolve(item, action) {
    setBusyId(item.id);
    try {
      await api.post(`/vendor/cash-handovers/${item.id}/${action}`);
      toast(action === "confirm" ? `Received ${inr(item.amount)} ✔` : "Marked as not received", "success");
      await load();
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function record() {
    setBusyId("new");
    key.current ??= idempotencyHeaders();
    try {
      await api.post("/vendor/cash-handovers", { rider_id: Number(riderId), amount }, { headers: key.current });
      toast("Cash recorded ✔", "success");
      key.current = null;
      setOpen(false);
      setRiderId("");
      setAmount("");
      await load();
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mx-4 mt-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <h2 className="text-sm font-bold text-slate-900">💵 Cash from riders</h2>

      {pending.map((item) => (
        <div key={item.id} className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white p-3">
          <p className="min-w-0 text-sm">
            <span className="font-semibold">{item.rider_name}</span> paid{" "}
            <span className="font-bold">{inr(item.amount)}</span>
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => resolve(item, "confirm")}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
            </button>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => resolve(item, "reject")}
              className="rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Not received
            </button>
          </div>
        </div>
      ))}

      {riders.length > 0 && (
        <div className="mt-3">
          {!open ? (
            <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-amber-800 underline">
              Received cash from a rider?
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={riderId}
                onChange={(e) => {
                  setRiderId(e.target.value);
                  setAmount(riders.find((r) => String(r.rider_id) === e.target.value)?.owed ?? "");
                  key.current = null;
                }}
                aria-label="Rider"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">Select rider</option>
                {riders.map((r) => (
                  <option key={r.rider_id} value={r.rider_id}>
                    {r.rider_name} — owes {inr(r.owed)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Amount received"
                className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={!riderId || !(Number(amount) > 0) || busyId === "new"}
                onClick={record}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Record
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
