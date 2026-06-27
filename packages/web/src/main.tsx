import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyAppearance, loadAppearance } from "./appearance.js";
// Fonts for the COSS design tokens (--font-sans / --font-mono). Variable
// builds, imported here instead of next/font. Must precede ./index.css.
// All selectable families are registered up front so switching is instant.
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "@fontsource-variable/urbanist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/jetbrains-mono";
// react-grid-layout base styles (item transition + placeholder). The resizable
// handle CSS + our theming live in index.css, imported last so it wins.
import "react-grid-layout/css/styles.css";
import "./index.css";

// Apply the persisted font/theme choice before first paint (no FOUC).
applyAppearance(loadAppearance());

const root = document.getElementById("root");
if (!root) throw new Error("missing #root mount node");
// NOTE (dev workaround): StrictMode's double-invoke runs the effect cleanup,
// which calls runtime.dispose() — disposing the runtime mid initial-run so it
// never notifies and the page stays on the loading skeleton. Disabled here
// while pointing at a real server. Real fix belongs in App.tsx lifecycle.
createRoot(root).render(<App />);
