import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../../utils/api.js";
import { PAYMENT_LABELS, inr } from "../../utils/format.js";

// IST calendar date, so "today" matches the server's day boundaries.
const istDate = (offsetDays = 0) =>
  new Date(Date.now() + 5.5 * 3600e3 - offsetDays * 86_400_000).toISOString().slice(0, 10);

const PRESETS = [
  { key: "today", label: "Today", from: () => istDate(0), to: () => istDate(0) },
  { key: "week", label: "Last 7 days", from: () => istDate(6), to: () => istDate(0) },
  { key: "month", label: "Last 30 days", from: () => istDate(29), to: () => istDate(0) },
];

function Tile({ label, value, tone = "text-slate-900", note }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-xl font-extrabold ${tone}`}>{value}</p>
      {note && <p className="text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

function BalanceRow({ name, row }) {
  return (
    <tr className={row.matches ? "" : "bg-red-50"}>
      <td className="py-1.5 pr-2">{name}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{inr(row.stored)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{row.ledger == null ? "—" : inr(row.ledger)}</td>
      <td className="py-1.5 text-right">
        {row.matches ? (
          <CheckCircle2 className="ml-auto h-4 w-4 text-green-600" aria-label="matches" />
        ) : (
          <AlertTriangle className="ml-auto h-4 w-4 text-red-600" aria-label="mismatch" />
        )}
      </td>
    </tr>
  );
}

/** Order → customer payment → vendor / rider / franchise / royalty (SPEC §41). */
export default function ReconciliationPanel({ toast }) {
  const [preset, setPreset] = useState("today");
  const [from, setFrom] = useState(istDate(0));
  const [to, setTo] = useState(istDate(0));
  const [report, setReport] = useState(null);
  const [orders, setOrders] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  const loadOrders = useCallback(async (range, after) => {
    const { data } = await api.get("/admin/reconciliation/orders", {
      params: { ...range, limit: 20, ...(after ? { cursor: after } : {}) },
    });
    setOrders((current) => (after ? [...current, ...data.data.orders] : data.data.orders));
    setCursor(data.meta.pagination?.next_cursor ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = { from, to };
      const [summary] = await Promise.all([api.get("/admin/reconciliation", { params: range }), loadOrders(range)]);
      setReport(summary.data.data);
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }, [from, to, loadOrders, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const choose = (p) => {
    setPreset(p.key);
    setFrom(p.from());
    setTo(p.to());
  };

  const t = report?.totals;
  const check = report?.check;
  const badBalances = report
    ? [
        report.balances.franchise_wallet,
        ...report.balances.riders,
        ...report.balances.vendors,
      ].filter((row) => !row.matches).length
    : 0;
  const inputCls = "rounded-xl border border-slate-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => choose(p)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              preset === p.key ? "bg-orange-600 text-white" : "bg-white ring-1 ring-slate-200"
            }`}
          >
            {p.label}
          </button>
        ))}
        <label className="text-xs font-medium text-slate-500">
          From
          <input type="date" className={`${inputCls} ml-1`} value={from} max={to} onChange={(e) => { setPreset(""); setFrom(e.target.value); }} />
        </label>
        <label className="text-xs font-medium text-slate-500">
          To
          <input type="date" className={`${inputCls} ml-1`} value={to} min={from} onChange={(e) => { setPreset(""); setTo(e.target.value); }} />
        </label>
        {loading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
      </div>

      {report && (
        <>
          <div
            className={`flex items-start gap-3 rounded-2xl p-4 ${
              check.orders_with_issues || badBalances ? "bg-red-50 text-red-900" : "bg-green-50 text-green-900"
            }`}
          >
            {check.orders_with_issues || badBalances ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <div className="text-sm">
              <p className="font-bold">
                {check.orders_with_issues || badBalances
                  ? `${check.orders_with_issues} order${check.orders_with_issues === 1 ? "" : "s"} and ${badBalances} balance${badBalances === 1 ? "" : "s"} need review`
                  : `All ${check.orders_scanned} delivered order${check.orders_scanned === 1 ? "" : "s"} reconcile`}
              </p>
              <p className="opacity-80">
                Each order's split and ledger entries are checked against its totals; stored balances are checked against their ledger.
                {check.truncated && " Only the first 5,000 orders were checked."}
              </p>
            </div>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-700">Where the money went · {t.orders} delivered</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Order total" value={inr(t.grand_total)} note={`items ${inr(t.item_total)} + delivery ${inr(t.delivery_fee)}`} />
              <Tile label="Vendors earned" value={inr(t.vendor_earning)} note={`commission ${inr(t.vendor_commission)}`} />
              <Tile label="Riders earned" value={inr(t.rider_earning)} note={`incl. tips ${inr(t.rider_tips)}`} />
              <Tile label="Franchise profit" value={inr(t.franchise_profit)} tone="text-green-700" />
              <Tile label="Royalty (Super Admin)" value={inr(t.super_admin_royalty)} />
              <Tile label="Cash taken by riders" value={inr(t.cash_collected_by_riders)} note={`bonuses ${inr(t.milestone_bonuses)}`} />
            </div>
          </section>

          {report.by_payment_method.length > 0 && (
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h3 className="mb-2 text-sm font-bold text-slate-700">Customer payments</h3>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr><th className="text-left font-medium">Method</th><th className="text-right font-medium">Orders</th><th className="text-right font-medium">Order total</th><th className="text-right font-medium">Paid to rider</th></tr>
                </thead>
                <tbody>
                  {report.by_payment_method.map((row) => (
                    <tr key={row.payment_method} className="border-t border-slate-100">
                      <td className="py-1.5">{PAYMENT_LABELS[row.payment_method] ?? row.payment_method}</td>
                      <td className="py-1.5 text-right">{row.orders}</td>
                      <td className="py-1.5 text-right tabular-nums">{inr(row.grand_total)}</td>
                      <td className="py-1.5 text-right tabular-nums">{inr(row.amount_to_collect)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {check.discrepancies.length > 0 && (
            <section className="rounded-2xl bg-white p-4 ring-2 ring-red-200">
              <h3 className="mb-2 text-sm font-bold text-red-700">Discrepancies</h3>
              <ul className="space-y-3 text-sm">
                {check.discrepancies.map((d) => (
                  <li key={d.order_id}>
                    <p className="font-semibold">{d.order_number}</p>
                    <ul className="ml-4 list-disc text-slate-700">
                      {d.issues.map((issue, i) => (
                        <li key={i}>
                          {issue.message}
                          {issue.expected != null && (
                            <span className="text-slate-500"> — expected {inr(issue.expected)}, found {issue.actual == null ? "none" : inr(issue.actual)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="mb-2 text-sm font-bold text-slate-700">Balances vs ledger</h3>
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr><th className="text-left font-medium">Account</th><th className="text-right font-medium">Stored</th><th className="text-right font-medium">Ledger</th><th /></tr>
              </thead>
              <tbody>
                <BalanceRow name="Royalty wallet" row={report.balances.franchise_wallet} />
                {report.balances.riders.map((r) => <BalanceRow key={`r${r.id}`} name={`Rider · ${r.name}`} row={r} />)}
                {report.balances.vendors.map((v) => <BalanceRow key={`v${v.id}`} name={`Vendor · ${v.shop_name}`} row={v} />)}
              </tbody>
            </table>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h3 className="mb-2 text-sm font-bold text-slate-700">Delivered orders</h3>
            {orders.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">No delivered orders in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="text-left font-medium">Order</th>
                      <th className="text-right font-medium">Total</th>
                      <th className="text-right font-medium">Vendor</th>
                      <th className="text-right font-medium">Rider</th>
                      <th className="text-right font-medium">Franchise</th>
                      <th className="text-right font-medium">Royalty</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className={`border-t border-slate-100 ${o.reconciled ? "" : "bg-red-50"}`} onClick={() => setOpen(open === o.id ? null : o.id)}>
                        <td className="py-1.5 pr-2">
                          <span className="font-medium">{o.order_number}</span>
                          <span className="block text-[11px] text-slate-400">{PAYMENT_LABELS[o.payment_method]}</span>
                          {open === o.id && !o.reconciled && (
                            <span className="mt-1 block text-[11px] text-red-700">{o.issues.map((i) => i.message).join("; ")}</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{inr(o.grand_total)}</td>
                        <td className="py-1.5 text-right tabular-nums">{inr(o.vendor_earning)}</td>
                        <td className="py-1.5 text-right tabular-nums">{inr(o.rider_earning)}</td>
                        <td className="py-1.5 text-right tabular-nums">{inr(o.franchise_profit)}</td>
                        <td className="py-1.5 text-right tabular-nums">{inr(o.super_admin_profit)}</td>
                        <td className="py-1.5 pl-2 text-right">
                          {o.reconciled ? <CheckCircle2 className="ml-auto h-4 w-4 text-green-600" /> : <AlertTriangle className="ml-auto h-4 w-4 text-red-600" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cursor && (
              <button type="button" onClick={() => loadOrders({ from, to }, cursor).catch((e) => toast(getErrorMessage(e), "error"))} className="mt-3 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold">
                Load older orders
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
