import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { APP } from "./appMode.js";
import { DropPuttMark } from "./components/DropPuttLogo.jsx";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";

// Which parts this build contains (see appMode.js). A build leaves out the other apps' pages
// entirely, so the vendor app carries no rider or admin code. `all` is the combined web build.
const HAS_CUSTOMER = APP === "all" || APP === "customer";
const HAS_VENDOR = APP === "all" || APP === "vendor";
const HAS_RIDER = APP === "all" || APP === "rider";
const HAS_ADMIN = APP === "all" || APP === "admin";
const HAS_LOGIN = APP !== "customer"; // customers order without an account

// One chunk per app, so the customer's Magic Link page stays light on rural data.
const AdminDashboard = HAS_ADMIN ? lazy(() => import("./pages/AdminDashboard.jsx")) : null;
const CustomerDropPage = HAS_CUSTOMER ? lazy(() => import("./pages/CustomerDropPage.jsx")) : null;
// The customer storefront: shell + home + shop menu.
const Storefront = HAS_CUSTOMER ? lazy(() => import("./pages/Storefront.jsx")) : null;
const StorefrontHome = HAS_CUSTOMER ? lazy(() => import("./pages/StorefrontHome.jsx")) : null;
const RestaurantsPage = HAS_CUSTOMER ? lazy(() => import("./pages/RestaurantsPage.jsx")) : null;
const MartPage = HAS_CUSTOMER ? lazy(() => import("./pages/MartPage.jsx")) : null;
const ShopDishes = HAS_CUSTOMER ? lazy(() => import("./pages/ShopDishes.jsx")) : null;
const ShopMenu = HAS_CUSTOMER ? lazy(() => import("./pages/ShopMenu.jsx")) : null;
const RiderDashboard = HAS_RIDER ? lazy(() => import("./pages/RiderDashboard.jsx")) : null;
const RiderEarnings = HAS_RIDER ? lazy(() => import("./pages/RiderEarnings.jsx")) : null;
const VendorMenu = HAS_VENDOR ? lazy(() => import("./pages/VendorMenu.jsx")) : null;
const VendorHistory = HAS_VENDOR ? lazy(() => import("./pages/VendorHistory.jsx")) : null;
const VendorDashboard = HAS_VENDOR ? lazy(() => import("./pages/VendorDashboard.jsx")) : null;

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <DropPuttMark size={64} className="motion-safe:animate-pulse" />
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

const guard = (roles, page) => <RequireAuth roles={roles}>{page}</RequireAuth>;

export default function App() {
  const customerOnly = APP === "customer";
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {HAS_LOGIN && <Route path="/login" element={<Login />} />}
        {/* Public storefront: customers order without an account; the Magic Link token is the credential. */}
        {HAS_CUSTOMER && (
          <>
            <Route path="/shop" element={<Storefront />}>
              <Route index element={<StorefrontHome />} />
              <Route path="restaurants" element={<RestaurantsPage />} />
              <Route path="mart" element={<MartPage />} />
              <Route path="restaurant/:vendorId" element={<ShopDishes />} />
              <Route path=":vendorId" element={<ShopMenu />} />
            </Route>
            <Route path="/drop/:token" element={<CustomerDropPage />} />
          </>
        )}
        {HAS_ADMIN && <Route path="/admin" element={guard(["FRANCHISE_ADMIN", "SUPER_ADMIN"], <AdminDashboard />)} />}
        {HAS_VENDOR && (
          <>
            <Route path="/vendor" element={guard(["VENDOR"], <VendorDashboard />)} />
            <Route path="/vendor/menu" element={guard(["VENDOR"], <VendorMenu />)} />
            <Route path="/vendor/history" element={guard(["VENDOR"], <VendorHistory />)} />
          </>
        )}
        {HAS_RIDER && (
          <>
            <Route path="/rider/earnings" element={guard(["RIDER"], <RiderEarnings />)} />
            <Route path="/rider" element={guard(["RIDER"], <RiderDashboard />)} />
          </>
        )}
        <Route path="/" element={customerOnly ? <Navigate to="/shop" replace /> : guard(undefined, <Home />)} />
        <Route path="*" element={<Navigate to={customerOnly ? "/shop" : "/"} replace />} />
      </Routes>
    </Suspense>
  );
}
