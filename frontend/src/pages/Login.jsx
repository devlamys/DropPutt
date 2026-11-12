import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Bike, Loader2, MapPin, ShieldCheck, Store, UserCog } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { getErrorMessage, getHostSlug } from "../utils/api.js";

const DEMO_PIN = import.meta.env.VITE_DEMO_PIN || "1234";
const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true";

// Accounts created by backend `prisma db seed`. The Super Admin belongs to no
// franchise and signs in through the reserved "admin" slug.
const DEMO_ACCOUNTS = [
  { key: "vendor", label: "Vendor", hint: "Farsa Hotel", phone: "9000000011", icon: Store },
  { key: "rider", label: "Rider", hint: "Ameen", phone: "9000000021", icon: Bike },
  {
    key: "franchise-admin",
    label: "Franchise Admin",
    hint: "Kizhissery",
    phone: "9000000002",
    icon: UserCog,
  },
  {
    key: "super-admin",
    label: "Super Admin",
    hint: "All franchises",
    phone: "9000000001",
    icon: ShieldCheck,
    franchiseSlug: "admin",
  },
];

export default function Login() {
  const { isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(null); // "form" | demo key | null
  const [error, setError] = useState("");

  const redirectTo = location.state?.from?.pathname || "/"; // "/" routes by role
  if (isAuthenticated) return <Navigate to={redirectTo} replace />;

  async function attempt(key, credentials) {
    setBusy(key);
    setError("");
    try {
      await signIn(credentials);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Could not sign in. Please try again."));
      setBusy(null);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    attempt("form", { phone: phone.trim(), pin });
  }

  const disabled = busy !== null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <header className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-600 text-white shadow">
          <MapPin className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">DropPutt</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sign in to <span className="font-medium capitalize">{getHostSlug()}</span>
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
      >
        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium">
            Mobile number
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="username"
            placeholder="10-digit number"
            maxLength={15}
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
          />
        </div>
        <div>
          <label htmlFor="pin" className="mb-1 block text-sm font-medium">
            PIN
          </label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="4–12 digits"
            minLength={4}
            maxLength={12}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={disabled}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
        >
          {busy === "form" && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>
      </form>

      {SHOW_DEMO && (
        <section aria-labelledby="demo-heading" className="space-y-3">
          <h2
            id="demo-heading"
            className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Quick demo login
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {DEMO_ACCOUNTS.map(({ key, label, hint, phone: demoPhone, icon: Icon, franchiseSlug }) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => attempt(key, { phone: demoPhone, pin: DEMO_PIN, franchiseSlug })}
                className="flex flex-col items-start gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-orange-400 hover:bg-orange-50 disabled:opacity-60"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {busy === key ? (
                    <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
                  ) : (
                    <Icon className="h-4 w-4 text-orange-600" aria-hidden="true" />
                  )}
                  {label}
                </span>
                <span className="text-xs text-slate-500">{hint}</span>
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-slate-400">
            Development accounts from the backend seed (PIN {DEMO_PIN}).
          </p>
        </section>
      )}
    </main>
  );
}
