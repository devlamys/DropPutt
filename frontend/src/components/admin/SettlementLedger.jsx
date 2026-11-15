import { Loader2, Lock, Unlock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../Modal.jsx";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

/** Nightly cash hand-over: settling cash_in_hand unlocks capped riders. */
export default function SettlementLedger({ date, riders, onSettled, toast }) {
  const [settling, setSettling] = useState(null);
  const [limiting, setLimiting] = useState(null);
  const [paying, setPaying] = useState(null);
  const [netting, setNetting] = useState(null);
  const [handovers, setHandovers] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const outstanding = riders.reduce((sum, r) => sum + Number(r.cash_in_hand), 0);
  const locked = riders.filter((r) => r.is_cash_locked).length;

  const loadHandovers = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/cash-handovers", { params: { status: "PENDING" } });
      setHandovers(data.data.items);
    } catch {
      /* the overview already reports errors */
    }
  }, []);
  // `riders` changes on every overview reload, which keeps this list fresh.
  useEffect(() => {
    loadHandovers();
  }, [loadHandovers, riders]);

  async function resolve(item, action) {
    setBusyId(item.id);
    try {
      await api.post(`/admin/cash-handovers/${item.id}/${action}`);
      toast(action === "confirm" ? "Handover confirmed" : "Handover rejected", "success");
      await loadHandovers();
      onSettled();
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {handovers.length > 0 && (
        <section className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <h3 className="text-sm font-bold">Waiting for the hotel to confirm</h3>
          <ul className="mt-2 space-y-2">
            {handovers.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 text-sm">
                <span className="min-w-0">
                  <b>{h.rider_name}</b> → {h.shop_name} · {inr(h.amount)}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busyId === h.id}
                    onClick={() => resolve(h, "confirm")}
                    className="rounded-lg bg-green-600 px-3 py-1.5 font-bold text-white disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={busyId === h.id}
                    onClick={() => resolve(h, "reject")}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 font-semibold disabled:opacity-50"
                  >
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
                    {inr(cash)} / {inr(limit)}{" "}
                    <button
                      type="button"
                      onClick={() => setLimiting(rider)}
                      className="ml-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700"
                    >
                      Edit limit
                    </button>
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-green-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {/* §15.2: cash the rider owes vs earnings the franchise owes, netted */}
              {(cash > 0 || Number(rider.wallet_earnings) > 0) && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-2.5 text-xs">
                  <span className="text-slate-600">
                    Earnings to pay {inr(rider.wallet_earnings)} ·{" "}
                    <strong className={Number(rider.net_due) >= 0 ? "text-slate-900" : "text-green-700"}>
                      {Number(rider.net_due) >= 0
                        ? `Net: rider gives ${inr(rider.net_due)}`
                        : `Net: you give rider ${inr(Math.abs(Number(rider.net_due)))}`}
                    </strong>
                  </span>
                  <span className="flex gap-2">
                    {Number(rider.wallet_earnings) > 0 && (
                      <button type="button" onClick={() => setPaying(rider)} className="rounded-lg bg-white px-2.5 py-1 font-semibold ring-1 ring-slate-300">
                        Pay earnings
                      </button>
                    )}
                    <button type="button" onClick={() => setNetting(rider)} className="rounded-lg bg-slate-900 px-2.5 py-1 font-semibold text-white">
                      Net settle
                    </button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {paying && (
        <PayEarningsModal
          rider={paying}
          onClose={() => setPaying(null)}
          onDone={(data) => {
            setPaying(null);
            toast(`Paid ${inr(data.payout.amount)} to ${paying.name}`, "success");
            onSettled();
          }}
        />
      )}
      {netting && (
        <NetSettleModal
          rider={netting}
          onClose={() => setNetting(null)}
          onDone={(data) => {
            setNetting(null);
            toast(
              data.direction === "RIDER_PAYS"
                ? `${netting.name} handed over ${inr(data.net)}. Settled.`
                : data.direction === "FRANCHISE_PAYS"
                  ? `You paid ${netting.name} ${inr(Math.abs(Number(data.net)))}. Settled.`
                  : `${netting.name} is settled.`,
              "success"
            );
            onSettled();
          }}
        />
      )}

      {limiting && (
        <LimitModal
          rider={limiting}
          onClose={() => setLimiting(null)}
          onDone={(data) => {
            setLimiting(null);
            toast(
              `${limiting.name}: limit ${inr(data.max_cash_limit)}.${data.is_cash_locked ? " Rider is blocked until cash is settled." : " Rider can take orders."}`,
              data.is_cash_locked ? "warn" : "success"
            );
            onSettled();
          }}
        />
      )}

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

function LimitModal({ rider, onClose, onDone }) {
  const [limit, setLimit] = useState(String(Number(rider.max_cash_limit)));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const blocked = Number(limit) > 0 && Number(rider.cash_in_hand) >= Number(limit);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const { data } = await api.patch(`/admin/riders/${rider.id}/cash-limit`, { max_cash_limit: String(limit) });
      onDone(data.data);
    } catch (error) {
      setProblem(getErrorMessage(error, "Could not change the limit."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Cash limit · ${rider.name}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Cash in hand: <strong>{inr(rider.cash_in_hand)}</strong>. The rider cannot accept orders while cash in hand is at or above the limit.
        </p>
        <input
          type="number"
          inputMode="decimal"
          min="1"
          max="100000"
          step="1"
          required
          aria-label="Cash limit"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-lg font-bold"
        />
        <div className="flex gap-2">
          {[-500, -100, 100, 500].map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => setLimit(String(Math.max(1, Number(limit || 0) + step)))}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold"
            >
              {step > 0 ? `+${step}` : step}
            </button>
          ))}
        </div>
        {blocked && <p className="text-sm font-semibold text-amber-700">This rider will be blocked until cash is settled.</p>}
        {problem && <p role="alert" className="text-sm font-semibold text-red-600">{problem}</p>}
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-bold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save limit
        </button>
      </form>
    </Modal>
  );
}

function PayEarningsModal({ rider, onClose, onDone }) {
  const [amount, setAmount] = useState(String(Number(rider.wallet_earnings)));
  const [method, setMethod] = useState("CASH");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const headers = useRef(idempotencyHeaders());

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      const { data } = await api.post(`/admin/riders/${rider.id}/payouts`, { amount: String(amount), method }, { headers: headers.current });
      onDone(data.data);
    } catch (error) {
      setProblem(getErrorMessage(error, "Could not record the payment."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Pay earnings · ${rider.name}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Earnings the rider could not keep from cash (UPI orders, bonuses): <strong>{inr(rider.wallet_earnings)}</strong>.
        </p>
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          max={rider.wallet_earnings}
          required
          aria-label="Amount paid"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-lg font-bold"
        />
        <div className="flex gap-2">
          {["CASH", "UPI", "BANK"].map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} className={`rounded-full px-3 py-1 text-xs font-semibold ${method === m ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
              {m}
            </button>
          ))}
        </div>
        {problem && <p role="alert" className="text-sm font-semibold text-red-600">{problem}</p>}
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-bold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Record payment
        </button>
      </form>
    </Modal>
  );
}

function NetSettleModal({ rider, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const headers = useRef(idempotencyHeaders());
  const net = Number(rider.net_due);

  async function confirm() {
    setBusy(true);
    setProblem("");
    try {
      const { data } = await api.post(`/admin/riders/${rider.id}/net-settlement`, {}, { headers: headers.current });
      onDone(data.data);
    } catch (error) {
      setProblem(getErrorMessage(error, "Could not settle."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Net settle · ${rider.name}`} onClose={busy ? () => {} : onClose}>
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-1 rounded-xl bg-slate-50 p-3">
          <dt>Cash the rider holds</dt>
          <dd className="text-right font-semibold">{inr(rider.cash_in_hand)}</dd>
          <dt>Earnings you owe the rider</dt>
          <dd className="text-right font-semibold">{inr(rider.wallet_earnings)}</dd>
        </dl>
        <p className="rounded-xl bg-orange-50 p-3 text-base font-bold text-orange-800">
          {net > 0
            ? `${rider.name} gives you ${inr(net)}`
            : net < 0
              ? `You give ${rider.name} ${inr(Math.abs(net))}`
              : "Nothing changes hands"}
        </p>
        <p className="text-xs text-slate-500">Both balances become ₹0. Only confirm after the money has changed hands.</p>
        {problem && <p role="alert" className="font-semibold text-red-600">{problem}</p>}
        <button type="button" disabled={busy} onClick={confirm} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-bold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm settled
        </button>
      </div>
    </Modal>
  );
}
