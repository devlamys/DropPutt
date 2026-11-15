import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

// Rider side of the cash handover: "I paid the hotel". The vendor confirms
// with one tap and the cash-limit block lifts. `reloadKey` changes whenever
// a socket event says something moved.
export default function CashHandoverPanel({ reloadKey, onSettled, toast }) {
  const [data, setData] = useState(null);
  const [vendorId, setVendorId] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(null); // one Idempotency-Key per attempt, so a retry cannot double-post

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get("/rider/me/cash-owed");
      setData(res.data);
    } catch {
      /* the top bar already shows connectivity problems */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (!data) return null;
  const pending = data.pending ?? [];
  const vendors = data.vendors ?? [];
  const cash = Number(data.cash_in_hand);
  const limit = Number(data.max_cash_limit);
  const show = data.is_cash_locked || pending.length > 0 || (vendors.length > 0 && cash >= limit * 0.7);
  if (!show) return null;

  const selected = vendors.find((v) => v.vendor_id === vendorId);

  function pick(v) {
    setVendorId(v.vendor_id);
    setAmount(v.owed);
    key.current = null;
  }

  async function submit() {
    if (!selected || busy) return;
    setBusy(true);
    key.current ??= idempotencyHeaders();
    try {
      await api.post(
        "/rider/me/cash-handover",
        { vendor_id: selected.vendor_id, amount },
        { headers: key.current }
      );
      toast(`Sent to ${selected.shop_name}. They will confirm.`, "success");
      setVendorId(null);
      key.current = null;
      await load();
      onSettled?.();
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`rounded-2xl p-4 ${data.is_cash_locked ? "bg-red-50 ring-1 ring-red-200" : "bg-amber-50 ring-1 ring-amber-200"}`}
    >
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        {data.is_cash_locked && <Lock className="h-4 w-4 text-red-600" />}
        {data.is_cash_locked ? "Cash limit reached — pay the hotel to get orders again" : "Cash in hand is high"}
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        You hold {inr(cash)} of {inr(limit)}. Pay the hotel, then tap “I paid”.
      </p>

      {pending.map((p) => (
        <p key={p.id} className="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
          ⏳ Waiting for {p.shop_name} to confirm {inr(p.amount)}
        </p>
      ))}

      <ul className="mt-3 space-y-2">
        {vendors.map((v) => (
          <li key={v.vendor_id} className="rounded-xl bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{v.shop_name}</p>
                <p className="text-xs text-slate-500">Owed {inr(v.owed)}</p>
              </div>
              <button
                type="button"
                onClick={() => pick(v)}
                className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white"
              >
                I paid
              </button>
            </div>
            {vendorId === v.vendor_id && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={v.owed}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label="Amount paid"
                  className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !(Number(amount) > 0)}
                  onClick={submit}
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send for confirmation
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
