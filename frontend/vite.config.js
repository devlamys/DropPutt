import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// One code base, several apps: `--mode vendor` builds the vendor app, and so on (src/appMode.js).
const APPS = {
  all: { name: "DropPutt", short: "DropPutt", tagline: "FOOD • GROCERY • PICK & DROP", start: "/", theme: "#E8431A" },
  customer: { name: "DropPutt", short: "DropPutt", tagline: "FOOD • GROCERY • PICK & DROP", start: "/shop", theme: "#E8431A" },
  vendor: { name: "DropPutt Vendor", short: "DP Vendor", tagline: "SHOP DASHBOARD", start: "/vendor", theme: "#E8431A" },
  rider: { name: "DropPutt Rider", short: "DP Rider", tagline: "DELIVERY PARTNER", start: "/rider", theme: "#E8431A" },
  admin: { name: "DropPutt Admin", short: "DP Admin", tagline: "CONTROL ROOM", start: "/admin", theme: "#E8431A" },
};

/** Per-app page title, splash text, theme colour and web manifest (installed name and start page). */
function appBranding(app) {
  const info = APPS[app];
  const manifest = JSON.stringify(
    {
      name: info.name,
      short_name: info.short,
      description: "Hyperlocal delivery",
      start_url: info.start,
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: info.theme,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2
  );
  return {
    name: "dropputt-app-branding",
    transformIndexHtml: (html) =>
      html
        .replaceAll("%APP_NAME%", info.name)
        .replaceAll("%APP_TAGLINE%", info.tagline)
        .replaceAll("%APP_THEME%", info.theme),
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (req, res) => {
        res.setHeader("content-type", "application/manifest+json");
        res.end(manifest);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: manifest });
    },
  };
}

export default defineConfig(({ mode }) => {
  const app = Object.hasOwn(APPS, mode) ? mode : "all";
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_DEV_PROXY_TARGET || "http://localhost:3000";
  return {
    plugins: [react(), appBranding(app)],
    define: { "import.meta.env.VITE_APP": JSON.stringify(app) },
    server: {
      host: true, // listen on all interfaces (phones / tunnels)
      port: 5173,
      allowedHosts: true, // Vite 5+ blocks unknown Host headers, e.g. *.trycloudflare.com
      // Same-origin in development: no CORS, and sockets/uploads work too.
      proxy: {
        "/api": { target: backend, changeOrigin: true },
        "/uploads": { target: backend, changeOrigin: true },
        "/socket.io": { target: backend, ws: true, changeOrigin: true },
      },
    },
  };
});
