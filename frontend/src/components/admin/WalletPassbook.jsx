import { Loader2, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import api, { getErrorMessage, idempotencyHeaders } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

/** Prepaid royalty wallet: every delivered order debits the royalty. */
export default function WalletPassbook({ franchise, isSuperAdmin, onChanged, toast }) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (after) => {
      const { data } = await api.get("/admin/wallet-transactions", {
        params: { limit: 25, ...(after ? { cursor: after } : {}) },
      });
      setRows((current) => (after ? [...current, ...data.data.items] : data.data.items));
      setCursor(data.meta.pagination?.next_cursor ?? null);
    },
    []
  );

  useEffect(() => {
    load()
      .catch((error) => toast(getErrorMessage(error), "error"))
      .finally(() => setLoading(false));
  }, [load, toast, franchise.wallet_balance]);

  const balance = Number(franchise.wallet_balance);
  const min = Number(franchise.min_balance_limit);
  const royalty = Number(franchise.royalty_per_order);
  const blocked = balance <= min;
  const ordersLeft = royalty > 0 ? Math.max(0, Math.floor((balance - min) / royalty)) : null;

  return (
    <div className="space-y-4">
      <section className={`rounded-2xl p-5 text-white shadow ${blocked ? "bg-gradient-to-br from-red-600 to-red-800" : "bg-gradient-to-br from-slate-800 to-slate-950"}`}>
        <p className="flex items-center gap-2 text-sm opacity-80">
          <Wallet className="h-4 w-4" /> Royalty wallet · {franchise.name}
        </p>
        <p className="mt-1 text-4xl font-extrabold">{inr(balance)}</p>
        <p className="mt-2 text-sm opacity-90">
          {blocked
            ? "⛔ New orders are blocked. Recharge the wallet."
            : `≈ ${ordersLeft} more orders before the ${inr(min)} limit (${inr(royalty)} royalty per order)`}
        </p>
      </section>

      {isSuperAdmin ? (
        <TopUpForm onDone={() => onChanged()} toast={toast} />
      ) : (
        <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
          To recharge, pay the Super Admin. The top-up appears here once they record it.
        </p>
      )}

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <h3 className="border-b px-4 py-3 font-bold">Passbook</h3>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">No transactions yet.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.description}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(row.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-bold ${row.type === "CREDIT" ? "text-green-700" : "text-red-600"}`}>
                    {row.type === "CREDIT" ? "+" : "−"}
                    {inr(row.amount)}
                  </p>
                  <p className="text-xs text-slate-500">Bal {inr(row.balance_after)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button
            type="button"
            disabled={more}
            onClick={async () => {
              setMore(true);
              try {
                await load(cursor);
              } catch (error) {
                toast(getErrorMessage(error), "error");
              } finally {
                setMore(false);
              }
            }}
            className="w-full border-t py-3 text-sm font-semibold text-orange-700"
          >
            {more ? "Loading…" : "Load older"}
          </button>
        )}
      </section>
    </div>
  );
}

function TopUpForm({ onDone, toast }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = useRef(idempotencyHeaders());

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post(
        "/admin/franchise/wallet/top-up",
        { amount: String(amount), ...(description.trim() ? { description: description.trim() } : {}) },
        { headers: headers.current }
      );
      toast(`Wallet credited ${inr(data.data.amount)}. Balance ${inr(data.data.wallet_balance)}.`, "success");
      setAmount("");
      setDescription("");
      headers.current = idempotencyHeaders(); // next top-up is a new action
      onDone();
    } catch (error) {
      toast(getErrorMessage(error, "Top-up failed."), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
      <h3 className="font-bold">Record a top-up (Super Admin)</h3>
      <div className="flex flex-wrap gap-2">
        {[500, 1000, 2000].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setAmount(String(value))}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${Number(amount) === value ? "border-orange-600 bg-orange-600 text-white" : "border-slate-300"}`}
          >
            {inr(value)}
          </button>
        ))}
      </div>
      <input
        type="number"
        inputMode="decimal"
        min="1"
        step="0.01"
        required
        placeholder="Amount (₹)"
        aria-label="Top-up amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
      />
      <input
        maxLength={300}
        placeholder="Reference (e.g. UPI ref 4321)"
        aria-label="Top-up reference"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
      />
      <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 py-3 font-bold text-white disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Credit wallet
      </button>
    </form>
  );
}
