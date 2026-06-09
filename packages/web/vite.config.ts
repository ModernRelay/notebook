import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { target: "es2022", sourcemap: true },
  server: {
    fs: {
      // Allow imports from the workspace root (we pull notebook YAML / JSON
      // from the sibling examples/ directory via ?raw and JSON imports).
      allow: ["../../"],
    },
    // Dev-only: proxy /og → a local omnigraph-server so the browser talks
    // same-origin (no CORS). Use ?server=/og in the URL to route through it.
    proxy: {
      "/og": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/og/, ""),
      },
    },
  },
});
