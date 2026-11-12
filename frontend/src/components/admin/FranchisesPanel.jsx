import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import api, { getErrorMessage } from "../../utils/api.js";
import { inr } from "../../utils/format.js";

const BASE_DOMAIN = "techkerala.in";

/** Super Admin: every franchise, plus creating a new one with its admin login. */
export default function FranchisesPanel({ franchises, current, onSelect, onChanged, toast }) {
  const [form, setForm] = useState({ name: "", slug: "", royalty: "3", wallet: "", adminName: "", adminPhone: "", adminPin: "" });
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(null);
  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.value,
      // Suggest the subdomain from the name until the slug is edited by hand.
      ...(key === "name" && (f.slug === "" || f.slug === slugify(f.name)) ? { slug: slugify(e.target.value) } : {}),
    }));

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/super/franchises", {
        name: form.name.trim(),
        slug: form.slug.trim(),
        royalty_per_order: form.royalty || "3",
        ...(form.wallet ? { opening_wallet_balance: form.wallet } : {}),
        admin: { name: form.adminName.trim(), phone: form.adminPhone.trim(), pin: form.adminPin },
      });
      toast(`Created ${data.data.franchise.name} (${data.data.franchise.slug}.${BASE_DOMAIN})`, "success");
      setForm({ name: "", slug: "", royalty: "3", wallet: "", adminName: "", adminPhone: "", adminPin: "" });
      onChanged();
    } catch (error) {
      const details = error?.response?.data?.error?.details;
      toast(details?.length ? `${details[0].field}: ${details[0].issue}` : getErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(franchise) {
    setToggling(franchise.id);
    try {
      await api.patch(`/super/franchises/${franchise.id}`, { is_active: !franchise.is_active });
      onChanged();
    } catch (error) {
      toast(getErrorMessage(error), "error");
    } finally {
      setToggling(null);
    }
  }

  const field = "w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200";

  return (
    <div className="space-y-4">
      <ul className="divide-y overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {franchises.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-bold">
                {f.name} {f.slug === current && <span className="text-xs font-semibold text-orange-600">· viewing</span>}
              </p>
              <p className="text-xs text-slate-500">
                {f.slug}.{BASE_DOMAIN} · wallet {inr(f.wallet_balance)} · {f.counts?.vendors ?? 0} vendors · {f.counts?.riders ?? 0} riders · {f.counts?.orders ?? 0} orders
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleActive(f)}
                disabled={toggling === f.id}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${f.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}
              >
                {toggling === f.id ? "…" : f.is_active ? "Active" : "Suspended"}
              </button>
              {f.slug !== current && (
                <button type="button" onClick={() => onSelect(f.slug)} className="rounded-xl border px-3 py-1.5 text-xs font-semibold">
                  Open
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={create} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <h3 className="flex items-center gap-2 font-bold">
          <Plus className="h-5 w-5" /> New franchise
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <input required minLength={2} placeholder="Franchise name (e.g. Edavannappara)" aria-label="Franchise name" value={form.name} onChange={set("name")} className={field} />
          <div>
            <input required pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" placeholder="subdomain" aria-label="Subdomain" value={form.slug} onChange={set("slug")} className={field} />
            <p className="mt-1 text-xs text-slate-500">{form.slug || "subdomain"}.{BASE_DOMAIN}</p>
          </div>
          <input type="number" min="0" step="0.01" placeholder="Royalty per order (₹)" aria-label="Royalty per order" value={form.royalty} onChange={set("royalty")} className={field} />
          <input type="number" min="0" step="0.01" placeholder="Opening wallet (₹, optional)" aria-label="Opening wallet balance" value={form.wallet} onChange={set("wallet")} className={field} />
        </div>
        <p className="pt-1 text-sm font-semibold">Franchise Admin login</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <input required minLength={2} placeholder="Admin name" aria-label="Admin name" value={form.adminName} onChange={set("adminName")} className={field} />
          <input required type="tel" inputMode="numeric" maxLength={10} pattern="\d{10}" placeholder="10-digit phone" aria-label="Admin phone" value={form.adminPhone} onChange={set("adminPhone")} className={field} />
          <input required type="password" inputMode="numeric" pattern="\d{4,12}" placeholder="PIN (4–12 digits)" aria-label="Admin PIN" autoComplete="new-password" value={form.adminPin} onChange={set("adminPin")} className={field} />
        </div>
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 py-3 font-bold text-white disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create franchise
        </button>
      </form>
    </div>
  );
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}
