import { Loader2, Lock, Unlock } from "lucide-react";
import { useRef, useState } from "react";
import Modal from "../Modal.jsx";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

/** Nightly cash hand-over: settling cash_in_hand unlocks capped riders. */
export default function SettlementLedger({ date, riders, onSettled, toast }) {
  const [settling, setSettling] = useState(null);
  const outstanding = riders.reduce((sum, r) => sum + Number(r.cash_in_hand), 0);
  const locked = riders.filter((r) => r.is_cash_locked).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
          <p className="text-xs text-slate-500">Cash with riders</p>
          <p className="text-2xl font-extrabold">{inr(outstanding)}</p>
        </div>
        <div className={`rounded-2xl p-3 ring-1 ${locked ? "bg-red-50 ring-red-200" : "bg-white ring-slate-200"}`}>
          <p className="text-xs text-slate-500">Locked riders</p>
          <p className="text-2xl font-extrabold">{locked}</p>
        </div>
      </div>
      <p className="text-xs text-slate-500">Ledger for {date} (IST). A rider at the cash limit cannot accept orders until settled.</p>

      <ul className="space-y-3">
        {riders.map((rider) => {
          const cash = Number(rider.cash_in_hand);
          const limit = Number(rider.max_cash_limit);
          const pct = limit > 0 ? Math.min(100, (cash / limit) * 100) : 0;
          return (
            <li key={rider.id} className={`rounded-2xl bg-white p-4 ring-1 ${rider.is_cash_locked ? "ring-2 ring-red-300" : "ring-slate-200"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-bold">
                    {rider.is_cash_locked && <Lock className="h-4 w-4 text-red-600" aria-label="Locked" />}
                    {rider.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {rider.delivered_today} delivered today · collected {inr(rider.cash_collected_today)} today
                  </p>
                </div>
                <button
                  type="button"
                  disabled={cash <= 0}
                  onClick={() => setSettling(rider)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300 ${
                    rider.is_cash_locked ? "bg-red-600" : "bg-slate-900"
                  }`}
                >
                  {rider.is_cash_locked && <Unlock className="h-4 w-4" />}
                  {cash > 0 ? `Settle ${inr(cash)}` : "Settled"}
                </button>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-600">Cash in hand</span>
                  <span className="font-semibold">
                    {inr(cash)} / {inr(limit)}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">Earnings wallet: {inr(rider.wallet_earnings)}</p>
            </li>
          );
        })}
      </ul>

      {settling && (
        <SettleModal
          rider={settling}
          onClose={() => setSettling(null)}
          onDone={(data) => {
            setSettling(null);
            toast(
              `${settling.name}: ${inr(data.amount_settled)} received. Cash left ${inr(data.cash_in_hand)}.${
                settling.is_cash_locked && Number(data.cash_in_hand) < Number(settling.max_cash_limit) ? " Rider unlocked." : ""
              }`,
              "success"
            );
            onSettled();
          }}
        />
      )}
    </div>
  );
}

function SettleModal({ rider, onClose, onDone }) {
  const [amount, setAmount] = useState(rider.cash_in_hand);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const headers = useRef(idempotencyHeaders()); // a retry never settles twice

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const { data } = await api.post(
        `/admin/riders/${rider.id}/cash-settlement`,
        { amount: String(amount), ...(note.trim() ? { note: note.trim() } : {}) },
        { headers: headers.current }
      );
      onDone(data.data);
    } catch (error) {
      setProblem(getErrorMessage(error, "Could not record the settlement."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Settle cash · ${rider.name}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Record the cash {rider.name} handed over. Cash in hand: <strong>{inr(rider.cash_in_hand)}</strong>.
        </p>
        <div>
          <label htmlFor="settle-amount" className="mb-1 block text-sm font-semibold">Amount received (₹)</label>
          <input
            id="settle-amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            max={rider.cash_in_hand}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-3 text-lg font-bold outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
          />
        </div>
        <div>
          <label htmlFor="settle-note" className="mb-1 block text-sm font-semibold">Note (optional)</label>
          <input
            id="settle-note"
            maxLength={300}
            placeholder="e.g. Night settlement, counted by Rafi"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
          />
        </div>
        {problem && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-green-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {busy && <Loader2 className="h-5 w-5 animate-spin" />}
          Confirm cash received
        </button>
      </form>
    </Modal>
  );
}
