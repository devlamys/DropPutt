import { LogOut } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { getRequestSlug } from "../utils/api.js";

const HOME_BY_ROLE = {
  VENDOR: "/vendor",
  RIDER: "/rider",
  FRANCHISE_ADMIN: "/admin",
  SUPER_ADMIN: "/admin",
};

const ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin",
  FRANCHISE_ADMIN: "Franchise Admin",
  VENDOR: "Vendor",
  RIDER: "Rider",
  CUSTOMER: "Customer",
};

// Placeholder landing page: role dashboards arrive in the next phase.
export default function Home() {
  const { user, signOut } = useAuth();
  if (HOME_BY_ROLE[user.role]) return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm text-slate-500">Signed in</p>
        <h1 className="mt-1 text-xl font-semibold">{user.name}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {ROLE_LABELS[user.role] ?? user.role} ·{" "}
          {user.role === "SUPER_ADMIN" ? "all franchises" : getRequestSlug()}
        </p>
        <p className="mt-4 text-sm text-slate-500">
          Your dashboard is coming in the next phase.
        </p>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium hover:bg-slate-100"
      >
        <LogOut className="h-4 w-4" /> Sign out
      </button>
    </main>
  );
}
