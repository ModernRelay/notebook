import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@` → packages/web/src. Vendored COSS components import siblings as
  // `@/components/ui/*` and the cn helper as `@/lib/utils`; tsconfig.json
  // mirrors this alias so tsc and Vite resolve identically.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { target: "es2022", sourcemap: true },
  server: {
    fs: {
      // Allow imports from the workspace root (we pull notebook YAML / JSON
      // from the sibling examples/ directory via ?raw and JSON imports, and
      // serve them over /@fs for `?notebook=` loads).
      allow: ["../../"],
    },
    // Dev-only: proxy /og → an omnigraph-server so the browser talks same-origin
    // (omnigraph-server 0.7.0 sets no CORS headers). Use ?server=/og to route
    // through it. Point at a remote graph with OMNIGRAPH_PROXY_TARGET; set
    // OMNIGRAPH_PROXY_TOKEN to inject the bearer token server-side (BFF pattern,
    // so it never reaches the browser). Defaults keep local-demo behaviour.
    proxy: {
      "/og": {
        target: process.env.OMNIGRAPH_PROXY_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/og/, ""),
        ...(process.env.OMNIGRAPH_PROXY_TOKEN
          ? {
              configure: (proxy) => {
                proxy.on("proxyReq", (proxyReq) => {
                  proxyReq.setHeader(
                    "authorization",
                    `Bearer ${process.env.OMNIGRAPH_PROXY_TOKEN}`,
                  );
                });
              },
            }
          : {}),
      },
    },
  },
});
