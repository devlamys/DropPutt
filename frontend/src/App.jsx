import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import RiderDashboard from "./pages/RiderDashboard.jsx";
import VendorDashboard from "./pages/VendorDashboard.jsx";

/** Where each role lands after signing in. */
const HOME_BY_ROLE = {
  VENDOR: "/vendor",
  RIDER: "/rider",
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
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/vendor"
        element={
          <RequireAuth roles={["VENDOR"]}>
            <VendorDashboard />
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
  );
}
