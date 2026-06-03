import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// All backend route prefixes that need to be reachable through the same
// public origin (Cloudflare tunnel) as the frontend. Each one is proxied
// to the local FastAPI server. Update this list if you add new backend
// route prefixes — Vite only proxies paths that match one of these.
const BACKEND_PATHS = [
  "/api",
  "/designs",
  "/upload-jobs",
  "/upload-logs",
  "/trademark",
  "/me",
  "/healthz",
  "/docs",
  "/openapi.json",
  "/redoc",
];

const backendProxy = Object.fromEntries(
  BACKEND_PATHS.map((p) => [
    p,
    {
      target: "http://127.0.0.1:8000",
      changeOrigin: true,
      ws: false,
    },
  ])
);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Allow the local hosts and the current Cloudflare tunnel hostname.
    // Update the trycloudflare entry when the tunnel name changes.
    allowedHosts: [
      "something-moderate-visible-hidden.trycloudflare.com",
      "localhost",
      "127.0.0.1",
      ".trycloudflare.com", // wildcard so any *.trycloudflare.com is OK
    ],
    // Forward backend API paths to FastAPI on the same origin so the
    // single Cloudflare tunnel can serve both the SPA and the API.
    proxy: backendProxy,
    // Serve index.html for all routes so /reset-password works as a deep link
    historyApiFallback: true,
  },
  preview: {
    // Same fallback for `vite preview` (built files)
    historyApiFallback: true,
    proxy: backendProxy,
  },
});
