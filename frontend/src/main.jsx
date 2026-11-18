import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Fade the splash (index.html) once React has taken over. It shows at least ~0.7 s on a
// cold start so the drop animation can play, but not at all on the customer's Magic Link
// page: that customer is on slow rural data and wants the map, not a logo.
const splash = document.getElementById("splash");
if (splash) {
  const minimum = window.location.pathname.startsWith("/drop/") ? 0 : 700;
  const wait = Math.max(0, minimum - performance.now());
  setTimeout(() => {
    splash.classList.add("hide");
    setTimeout(() => splash.remove(), 350);
  }, wait);
}
