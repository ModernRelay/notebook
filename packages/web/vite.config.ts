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
  },
});
