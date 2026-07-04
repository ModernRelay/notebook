import { parseNotebook } from "@modernrelay/notebook-core";
import { Client, ServerSource } from "@modernrelay/notebook-client";
import type { Source } from "@modernrelay/notebook-core";

import {
  normalizeOverrides,
  pruneOverrides,
  type LayoutOverrides,
} from "./layout-overrides.js";

import defaultServerNotebookYaml from "../../../examples/company-server.notebook.yaml?raw";

export interface AppConfig {
  notebook: ReturnType<typeof parseNotebook>;
  source: Source;
  label: string;
  /**
   * The committed layout sidecar (`<notebook>.layout.json`), injected by the
   * `view` BFF — the base layer under any personal localStorage tweaks. Null
   * without a sidecar (or outside the BFF, e.g. Vite dev).
   */
  initialLayout: LayoutOverrides | null;
  /** True when the serving BFF accepts PUT /layout ("Save layout" enabled). */
  canPersistLayout: boolean;
}

/**
 * Config the `view` CLI injects into index.html so the bare URL (no query
 * string) loads the served notebook over the same-origin `/og` proxy. URL
 * params still override each field (dev server / sharing a specific branch).
 */
interface InjectedConfig {
  notebook?: string;
  server?: string;
  graph?: string;
  branch?: string;
  allowRawGq?: boolean;
  layout?: unknown;
  canPersistLayout?: boolean;
}
declare global {
  interface Window {
    __DASHBOOK__?: InjectedConfig;
  }
}

function readToken(server: string): string | undefined {
  // In BFF/proxy mode the browser must hold no default graph token; the Node
  // proxy owns auth injection and strips any browser-supplied Authorization.
  if (isSameOriginOgProxy(server)) return undefined;

  // Only an explicit `?token=` (persisted for direct, non-proxy server mode).
  // No default token: through the `view` BFF the proxy injects the server-side
  // token and strips any client-supplied Authorization, so the browser holds
  // none of its own (canon §4.7).
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    window.localStorage.setItem("omnigraph_token", fromUrl);
    return fromUrl;
  }
  return window.localStorage.getItem("omnigraph_token") ?? undefined;
}

export async function buildConfig(): Promise<AppConfig> {
  const url = new URL(window.location.href);
  // Precedence per field: explicit URL param → CLI-injected config → notebook.
  const injected = window.__DASHBOOK__ ?? {};
  const notebookParam =
    url.searchParams.get("notebook") ?? injected.notebook ?? null;
  const notebookUrl =
    notebookParam !== null ? new URL(notebookParam, window.location.href) : null;

  const notebookYaml =
    notebookUrl !== null
      ? await fetchText(notebookUrl)
      : defaultServerNotebookYaml;
  const notebook = parseNotebook(notebookYaml);

  const serverParam =
    url.searchParams.get("server") ?? injected.server ?? notebook.server;
  // A relative server (e.g. `?server=/og`, the dev-proxy same-origin path)
  // must be resolved to an absolute URL: the omnigraph SDK builds requests
  // with `new URL(baseUrl + path)`, which throws on a relative base.
  const server =
    serverParam && serverParam.startsWith("/")
      ? new URL(serverParam, window.location.origin).toString()
      : serverParam;
  if (!server) {
    throw new Error(
      "Server mode requires top-level `server:` or a `?server=` URL parameter.",
    );
  }
  const branch =
    url.searchParams.get("branch") ?? injected.branch ?? undefined;
  // rawGq is off by default (operator/production context); enable only via the
  // explicit `?allowRawGq` escape hatch (e.g. `view --allow-raw-gq` forwards it).
  const allowRawGq =
    isTruthyParam(url.searchParams.get("allowRawGq")) ||
    injected.allowRawGq === true;
  // omnigraph-server 0.7.0+ is cluster-only; reads/writes are graph-scoped.
  const graph = url.searchParams.get("graph") ?? injected.graph ?? notebook.graph;
  if (!graph) {
    throw new Error(
      "Server mode requires a graph id: top-level `graph:` or a `?graph=` URL parameter.",
    );
  }
  const client = new Client({
    baseUrl: server,
    token: readToken(server),
    graphId: graph,
  });
  // Layout sidecar contents ride the injected config (read per page load by
  // the BFF); validate + prune against this notebook's cells before use.
  const liveIds = new Set(notebook.cells.map((c) => c.id));
  const initialLayout =
    injected.layout !== undefined && injected.layout !== null
      ? pruneOverrides(normalizeOverrides(injected.layout), liveIds)
      : null;

  return {
    notebook,
    source: new ServerSource(client, {
      ...(branch ? { branch } : {}),
      ...(allowRawGq ? { allowRawGq: true } : {}),
    }),
    label: `server: ${server} · graph: ${graph}${branch ? ` · ${branch}` : ""}`,
    initialLayout,
    canPersistLayout: injected.canPersistLayout === true,
  };
}

/** URL flag truthiness: present and not an explicit off value → true. */
function isTruthyParam(v: string | null): boolean {
  return v !== null && v !== "" && v !== "0" && v !== "false";
}

function isSameOriginOgProxy(server: string): boolean {
  try {
    const url = new URL(server);
    const path = url.pathname.replace(/\/$/, "");
    return (
      url.origin === window.location.origin &&
      (path === "/og" || path.startsWith("/og/"))
    );
  } catch {
    return false;
  }
}

async function fetchText(url: URL): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.toString()} returned ${res.status}`);
  return res.text();
}
