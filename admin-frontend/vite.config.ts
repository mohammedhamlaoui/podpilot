import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Local development reuses only the public Supabase client configuration.
  // Never load backend credentials into the browser bundle.
  const local = mode === "development" ? loadEnv(mode, "../backend", "") : {};
  return ({
  plugins: [react()],
  define: mode === "development" ? {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(local.SUPABASE_URL || ""),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(local.SUPABASE_ANON_KEY || ""),
  } : {},
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  preview: { host: "127.0.0.1", port: 4174 },
  build: { sourcemap: false },
  });
});
