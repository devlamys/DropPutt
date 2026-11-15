import { Loader2, Printer, Store } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../Modal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

const ymd = (date) =>
  new Date(date.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST calendar day
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86_400_000));
const PRESETS = [
  { key: "today", label: "Today", from: () => daysAgo(0) },
  { key: "week", label: "7 days", from: () => daysAgo(6) },
  { key: "month", label: "30 days", from: () => daysAgo(29) },
];

/**
 * Storefront commission accrues in each hotel's balance. The admin visits the
 * hotel (daily / weekly / monthly), reads out the statement and records the
 * payment here.
 */
export default function VendorSettlements({ toast }) {
  const [vendors, setVendors] = useState(null);
  const [open, setOpen] = useState(null); // vendor whose statement is showing
  const [paying, setPaying] = useState(null);
  const [terms, setTerms] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/vendors");
      setVendors(data.data.vendors);
    } catch (error) {
      toast(getErrorMessage(error), "error");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (!vendors) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const owedToUs = vendors.reduce((sum, v) => sum + Math.max(0, -Number(v.admin_payable_balance)), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <p className="text-xs text-slate-500">Hotels owe the franchise (commission)</p>
        <p className="text-2xl font-extrabold">{inr(owedToUs)}</p>
      </div>

      <ul className="space-y-3">
        {vendors.map((v) => {
          const balance = Number(v.admin_payable_balance);
          return (
            <li key={v.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-bold">
                    <Store className="h-4 w-4 text-slate-400" /> {v.shop_name}
                  </p>
                  <p className="text-xs text-slate-600">
                    Commission {Number(v.commission_rate)}% ·{" "}
                    {v.trial_active
                      ? `Call Rider Now free until ${new Date(new Date(v.commission_free_until).getTime() - 1).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                      : "Call Rider Now trial ended"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Earned: today {inr(v.commission.today)} · 7 days {inr(v.commission.last_7_days)} · 30 days{" "}
                    {inr(v.commission.last_30_days)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`text-lg font-extrabold ${balance < 0 ? "text-amber-700" : balance > 0 ? "text-green-700" : ""}`}>
                    {inr(Math.abs(balance))}
                  </p>
                  <p className="text-xs text-slate-500">
                    {v.owes === "VENDOR" ? "hotel owes you" : v.owes === "FRANCHISE" ? "you owe hotel" : "settled"}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setOpen(v)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold">
                  Statement
                </button>
                <button type="button" onClick={() => setTerms(v)} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold">
                  Terms
                </button>
                <button
                  type="button"
                  disabled={balance === 0}
                  onClick={() => setPaying(v)}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300"
                >
                  {balance < 0 ? "Record payment received" : "Record payment made"}
                </button>
              </div>
            </li>
          );
        })}
        {vendors.length === 0 && <p className="text-sm text-slate-500">No hotels in this franchise yet.</p>}
      </ul>

      {terms && (
        <TermsModal
          vendor={terms}
          onClose={() => setTerms(null)}
          onDone={() => {
            setTerms(null);
            toast("Saved", "success");
            load();
          }}
        />
      )}
      {open && <StatementModal vendor={open} onClose={() => setOpen(null)} toast={toast} />}
      {paying && (
        <PaymentModal
          vendor={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            toast("Payment recorded", "success");
            load();
          }}
        />
      )}
    </div>
  );
}

function StatementModal({ vendor, onClose, toast }) {
  const [preset, setPreset] = useState("week");
  const [data, setData] = useState(null);

  useEffect(() => {
    const from = PRESETS.find((p) => p.key === preset).from();
    setData(null);
    api
      .get(`/admin/vendors/${vendor.id}/statement`, { params: { from, to: daysAgo(0) } })
      .then((res) => setData(res.data.data))
      .catch((error) => toast(getErrorMessage(error), "error"));
  }, [vendor.id, preset, toast]);

  return (
    <Modal title={`Statement · ${vendor.shop_name}`} onClose={onClose}>
      <div className="mb-3 flex gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${preset === p.key ? "bg-slate-900 text-white" : "bg-slate-100"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {!data ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-500">{data.range.from} → {data.range.to}</p>
          <dl className="grid grid-cols-2 gap-1 rounded-xl bg-slate-50 p-3">
            <dt>Orders</dt><dd className="text-right font-semibold">{data.totals.orders}</dd>
            <dt>Food sales</dt><dd className="text-right font-semibold">{inr(data.totals.item_total)}</dd>
            <dt>Franchise commission</dt><dd className="text-right font-bold">{inr(data.totals.commission)}</dd>
            <dt>Balance now</dt><dd className="text-right font-bold">{inr(data.vendor.admin_payable_balance)}</dd>
          </dl>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
            {data.orders.map((o) => (
              <li key={o.id} className="flex justify-between gap-3 py-1.5">
                <span>
                  {o.order_number}
                  {o.commission_free && <span className="ml-1 text-xs text-slate-400">no commission</span>}
                </span>
                <span className="font-semibold">{inr(o.item_total)} · {inr(o.commission)}</span>
              </li>
            ))}
            {data.orders.length === 0 && <li className="py-3 text-slate-500">No delivered orders in this range.</li>}
          </ul>
          {data.settlements.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">Payments recorded</p>
              {data.settlements.map((s) => (
                <p key={s.id} className="text-xs">
                  {new Date(s.created_at).toLocaleDateString("en-IN")} · {s.direction === "VENDOR_PAID_FRANCHISE" ? "received" : "paid"} {inr(s.amount)} ({s.method})
                </p>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 py-2.5 font-semibold"
          >
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      )}
    </Modal>
  );
}

function PaymentModal({ vendor, onClose, onDone }) {
  const balance = Number(vendor.admin_payable_balance);
  const direction = balance < 0 ? "VENDOR_PAID_FRANCHISE" : "FRANCHISE_PAID_VENDOR";
  const [amount, setAmount] = useState(String(Math.abs(balance)));
  const [method, setMethod] = useState("CASH");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const headers = useRef(idempotencyHeaders()); // a retry never records twice

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await api.post(
        `/admin/vendors/${vendor.id}/settlements`,
        { direction, amount: String(amount), method, ...(note.trim() ? { note: note.trim() } : {}) },
        { headers: headers.current }
      );
      onDone();
    } catch (error) {
      setProblem(getErrorMessage(error, "Could not record the payment."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`${direction === "VENDOR_PAID_FRANCHISE" ? "Payment received" : "Payment made"} · ${vendor.shop_name}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          {direction === "VENDOR_PAID_FRANCHISE"
            ? `The hotel owes you ${inr(Math.abs(balance))}. A part payment is fine; the rest stays on the balance.`
            : `You owe the hotel ${inr(balance)}.`}
        </p>
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          max={Math.abs(balance)}
          required
          aria-label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-lg font-bold"
        />
        <div className="flex gap-2">
          {["CASH", "UPI", "BANK"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${method === m ? "bg-slate-900 text-white" : "bg-slate-100"}`}
            >
              {m}
            </button>
          ))}
        </div>
        <input
          maxLength={300}
          placeholder="Note (optional)"
          aria-label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
        />
        <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
          <input
            type="checkbox"
            checked={appEnabled}
            onChange={(e) => setAppEnabled(e.target.checked)}
            className="mt-1 h-5 w-5"
          />
          <span className="text-sm">
            <span className="block font-semibold">This shop uses the app</span>
            <span className="text-slate-500">
              Untick if the shop has no phone alerts: the rider then sees the items and quantities on their own screen and asks for them at the counter.
            </span>
          </span>
        </label>
        {problem && <p role="alert" className="text-sm font-semibold text-red-600">{problem}</p>}
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-bold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Record
        </button>
      </form>
    </Modal>
  );
}

const ymdIn = (days) => {
  const d = new Date(Date.now() + days * 86_400_000 + 5.5 * 3600_000);
  return d.toISOString().slice(0, 10);
};

/** Free-trial end date (franchise admin) and commission % (Super Admin only). */
function TermsModal({ vendor, onClose, onDone }) {
  const { user } = useAuth();
  const isSuper = user.role === "SUPER_ADMIN";
  const [until, setUntil] = useState(
    vendor.commission_free_until
      ? new Date(new Date(vendor.commission_free_until).getTime() - 1 + 5.5 * 3600_000).toISOString().slice(0, 10)
      : ""
  );
  const [rate, setRate] = useState(String(Number(vendor.commission_rate)));
  const [appEnabled, setAppEnabled] = useState(vendor.app_enabled !== false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await api.patch(`/admin/vendors/${vendor.id}`, {
        commission_free_until: until || null,
        app_enabled: appEnabled,
        ...(isSuper ? { commission_rate: Number(rate) } : {}),
      });
      onDone();
    } catch (error) {
      setProblem(getErrorMessage(error, "Could not save."));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Terms · ${vendor.shop_name}`} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="trial-until" className="mb-1 block text-sm font-semibold">“Call Rider Now” free until</label>
          <input
            id="trial-until"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ["+1 month", 30],
              ["+6 months", 183],
              ["Through today", 0],
            ].map(([label, days]) => (
              <button key={label} type="button" onClick={() => setUntil(ymdIn(days))} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setUntil("")} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">
              No trial
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Applies to orders picked up from now on. Storefront orders always pay commission.</p>
        </div>
        <div>
          <label htmlFor="comm-rate" className="mb-1 block text-sm font-semibold">Commission on food amount (%)</label>
          <input
            id="comm-rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            disabled={!isSuper}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 disabled:bg-slate-100"
          />
          {!isSuper && <p className="mt-1 text-xs text-slate-500">Only the Super Admin can change this.</p>}
        </div>
        {problem && <p role="alert" className="text-sm font-semibold text-red-600">{problem}</p>}
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-bold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </form>
    </Modal>
  );
}
