import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root mount node");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
