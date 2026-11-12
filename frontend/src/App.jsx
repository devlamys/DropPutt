import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";

// One chunk per app, so the customer's Magic Link page stays light on rural data.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard.jsx"));
const CustomerDropPage = lazy(() => import("./pages/CustomerDropPage.jsx"));
// The customer storefront is one chunk: shell + home + shop menu.
const Storefront = lazy(() => import("./pages/Storefront.jsx"));
const ShopHome = lazy(() => import("./pages/ShopHome.jsx"));
const ShopMenu = lazy(() => import("./pages/ShopMenu.jsx"));
const RiderDashboard = lazy(() => import("./pages/RiderDashboard.jsx"));
const RiderEarnings = lazy(() => import("./pages/RiderEarnings.jsx"));
const VendorHistory = lazy(() => import("./pages/VendorHistory.jsx"));
const VendorDashboard = lazy(() => import("./pages/VendorDashboard.jsx"));

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" />
    </div>
  );
}

/** Where each role lands after signing in. */
const HOME_BY_ROLE = {
  VENDOR: "/vendor",
  RIDER: "/rider",
  FRANCHISE_ADMIN: "/admin",
  SUPER_ADMIN: "/admin",
};

function RequireAuth({ roles, children }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role] || "/"} replace />;
  }
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Public Magic Link — the token is the credential, no login. */}
      {/* Public storefront: customers order without an account. */}
      <Route path="/shop" element={<Storefront />}>
        <Route index element={<ShopHome />} />
        <Route path=":vendorId" element={<ShopMenu />} />
      </Route>
      <Route path="/drop/:token" element={<CustomerDropPage />} />
      <Route
        path="/admin"
        element={
          <RequireAuth roles={["FRANCHISE_ADMIN", "SUPER_ADMIN"]}>
            <AdminDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/vendor"
        element={
          <RequireAuth roles={["VENDOR"]}>
            <VendorDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/vendor/history"
        element={
          <RequireAuth roles={["VENDOR"]}>
            <VendorHistory />
          </RequireAuth>
        }
      />
      <Route
        path="/rider/earnings"
        element={
          <RequireAuth roles={["RIDER"]}>
            <RiderEarnings />
          </RequireAuth>
        }
      />
      <Route
        path="/rider"
        element={
          <RequireAuth roles={["RIDER"]}>
            <RiderDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
