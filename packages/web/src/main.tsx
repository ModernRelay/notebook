import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
// Fonts for the COSS design tokens (--font-sans / --font-mono). Variable
// builds, imported here instead of next/font. Must precede ./index.css.
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root mount node");
// NOTE (dev workaround): StrictMode's double-invoke runs the effect cleanup,
// which calls runtime.dispose() — disposing the runtime mid initial-run so it
// never notifies and the page stays on the loading skeleton. Disabled here
// while pointing at a real server. Real fix belongs in App.tsx lifecycle.
createRoot(root).render(<App />);
