import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast.jsx";
import api, { getErrorMessage } from "../utils/api.js";
import { PAYMENT_LABELS, inr } from "../utils/format.js";

const when = (iso) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Past orders and the shop's running balance with the platform. */
export default function VendorHistory() {
  const { toast, node } = useToast();
  const [ledger, setLedger] = useState(null);
  const [ledgerCursor, setLedgerCursor] = useState(null);
  const [orders, setOrders] = useState([]);
  const [orderCursor, setOrderCursor] = useState(null);

  const loadLedger = useCallback(async (after) => {
    const { data } = await api.get("/vendor/ledger", { params: { limit: 15, ...(after ? { cursor: after } : {}) } });
    setLedger((current) => ({
      balance: data.data.admin_payable_balance,
      items: after ? [...(current?.items ?? []), ...data.data.items] : data.data.items,
    }));
    setLedgerCursor(data.meta.pagination?.next_cursor ?? null);
  }, []);

  const loadOrders = useCallback(async (after) => {
    const { data } = await api.get("/orders", { params: { status: "DELIVERED", limit: 15, ...(after ? { cursor: after } : {}) } });
    setOrders((current) => (after ? [...current, ...data.data.orders] : data.data.orders));
    setOrderCursor(data.meta.pagination?.next_cursor ?? null);
  }, []);

  useEffect(() => {
    Promise.all([loadLedger(), loadOrders()]).catch((error) => toast(getErrorMessage(error), "error"));
  }, [loadLedger, loadOrders, toast]);

  const balance = ledger ? Number(ledger.balance) : 0;
  const more = (fn, cursor) => () => fn(cursor).catch((e) => toast(getErrorMessage(e), "error"));

  return (
    <div className="mx-auto min-h-screen max-w-xl pb-10">
      {node}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <Link to="/vendor" aria-label="Back" className="rounded-full p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold">Orders &amp; payments</h1>
      </header>

      {!ledger ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <main className="space-y-4 px-4 pt-4">
          <div className={`rounded-2xl p-4 ${balance < 0 ? "bg-amber-50" : "bg-green-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {balance < 0 ? "You owe DropPutt" : "DropPutt owes you"}
            </p>
            <p className="text-3xl font-extrabold">{inr(Math.abs(balance))}</p>
            <p className="text-xs text-slate-600">
              Sum of every delivered order below. Prepaid orders where you already hold the money add only DropPutt's commission to what you owe.
            </p>
          </div>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-2 text-sm font-bold text-slate-700">Payment ledger</h2>
            {ledger.items.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {ledger.items.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold">{row.order_number}</p>
                      <p className="text-xs text-slate-500">{when(row.delivered_at ?? row.created_at)} · {PAYMENT_LABELS[row.payment_method]}</p>
                    </div>
                    <span className={`shrink-0 font-bold ${Number(row.amount) < 0 ? "text-amber-700" : "text-green-700"}`}>
                      {Number(row.amount) < 0 ? "−" : "+"}{inr(Math.abs(Number(row.amount)))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {ledgerCursor && <button type="button" onClick={more(loadLedger, ledgerCursor)} className="mt-2 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold">Load older</button>}
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-2 text-sm font-bold text-slate-700">Delivered orders</h2>
            {orders.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">No delivered orders yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <li key={o.id} className="py-2.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold">{o.order_number}</span>
                      <span className="font-bold">{inr(o.item_total)}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {when(o.delivered_at)}{o.rider ? ` · ${o.rider.name}` : ""}
                      {o.items?.length ? ` · ${o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {orderCursor && <button type="button" onClick={more(loadOrders, orderCursor)} className="mt-2 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold">Load older</button>}
          </section>
        </main>
      )}
    </div>
  );
}
