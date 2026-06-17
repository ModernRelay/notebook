import { defineConfig } from "tsup";

// Real npm packages — kept external so they resolve from the CLI's own
// node_modules at install time (a single shared instance; bundling react/ink
// would risk "invalid hook call"). Everything `@omnigraph/*` is a private
// workspace lib and is bundled in (noExternal) since it is never published.
const EXTERNAL = [
  "@modernrelay/omnigraph",
  "@json-render/core",
  "@json-render/ink",
  "ink",
  "react",
  "yaml",
  "zod",
];

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  external: EXTERNAL,
  noExternal: [/^@omnigraph\//],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  dts: false,
  sourcemap: true,
  shims: false,
  async onSuccess() {
    const { cp, rm } = await import("node:fs/promises");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    // 1. Ship the built web SPA inside the package so `serve` works post-install.
    await rm("web-dist", { recursive: true, force: true });
    await cp("../web/dist", "web-dist", { recursive: true });
    // 2. Generate the notebook JSON Schema via the just-built CLI (single source
    //    of truth — identical to `mr-notebook schema`).
    await promisify(execFile)("node", [
      "dist/cli.js",
      "schema",
      "--out",
      "notebook.schema.json",
    ]);
  },
});
