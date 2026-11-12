import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_DEV_PROXY_TARGET || "http://localhost:3000";
  return {
    plugins: [react()],
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
