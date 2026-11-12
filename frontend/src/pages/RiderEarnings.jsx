import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast.jsx";
import api, { getErrorMessage } from "../utils/api.js";
import { PAYMENT_LABELS, inr } from "../utils/format.js";

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-2xl font-extrabold">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const dayLabel = (ymd) =>
  new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "Asia/Kolkata" });

/** Rider earnings and delivery history (deep link dropputt://rider/earnings). */
export default function RiderEarnings() {
  const { toast, node } = useToast();
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [cursor, setCursor] = useState(null);

  const loadOrders = useCallback(async (after) => {
    const { data: res } = await api.get("/orders", {
      params: { status: "DELIVERED", limit: 15, ...(after ? { cursor: after } : {}) },
    });
    setOrders((current) => (after ? [...current, ...res.data.orders] : res.data.orders));
    setCursor(res.meta.pagination?.next_cursor ?? null);
  }, []);

  useEffect(() => {
    Promise.all([api.get("/rider/earnings"), loadOrders()])
      .then(([earnings]) => setData(earnings.data.data))
      .catch((error) => toast(getErrorMessage(error), "error"));
  }, [loadOrders, toast]);

  const max = data ? Math.max(1, ...data.days.map((d) => Number(d.earning) + Number(d.bonus))) : 1;

  return (
    <div className="mx-auto min-h-screen max-w-xl pb-10">
      {node}
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <Link to="/rider" aria-label="Back" className="rounded-full p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold">My earnings</h1>
      </header>

      {!data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <main className="space-y-4 px-4 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Today" value={inr(Number(data.today.earning) + Number(data.today.bonus))} sub={`${data.today.deliveries} deliveries · tips ${inr(data.today.tips)}`} />
            <Tile label="Last 7 days" value={inr(Number(data.last_7_days.earning) + Number(data.last_7_days.bonus))} sub={`${data.last_7_days.deliveries} deliveries`} />
            <Tile label="Last 30 days" value={inr(Number(data.last_30_days.earning) + Number(data.last_30_days.bonus))} sub={`${data.last_30_days.deliveries} deliveries · bonus ${inr(data.last_30_days.bonus)}`} />
            <Tile label="Wallet total" value={inr(data.wallet_earnings)} sub={`Cash in hand ${inr(data.cash_in_hand)}`} />
          </div>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 text-sm font-bold text-slate-700">Last 7 days</h2>
            <ul className="space-y-2">
              {data.days.map((d) => {
                const value = Number(d.earning) + Number(d.bonus);
                return (
                  <li key={d.date} className="flex items-center gap-3 text-sm">
                    <span className="w-14 shrink-0 text-slate-500">{dayLabel(d.date)}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.round((value / max) * 100)}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{inr(value)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-2 text-sm font-bold text-slate-700">Delivered orders</h2>
            {orders.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">No deliveries yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{o.shop_name || o.order_number}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(o.delivered_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                        {" · "}{PAYMENT_LABELS[o.payment_method]}
                      </p>
                    </div>
                    <span className="shrink-0 font-bold text-green-700">+{inr(o.rider_earning)}</span>
                  </li>
                ))}
              </ul>
            )}
            {cursor && (
              <button type="button" onClick={() => loadOrders(cursor).catch((e) => toast(getErrorMessage(e), "error"))} className="mt-2 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold">
                Load older
              </button>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
