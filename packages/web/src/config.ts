import { parseNotebook } from "@modernrelay/notebook-core";
import { Client, ServerSource } from "@modernrelay/notebook-client";
import type { Source } from "@modernrelay/notebook-core";

import defaultServerNotebookYaml from "../../../examples/company-server.notebook.yaml?raw";

export interface AppConfig {
  notebook: ReturnType<typeof parseNotebook>;
  source: Source;
  label: string;
}

function readToken(): string | undefined {
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
  const notebookParam = url.searchParams.get("notebook");
  const notebookUrl =
    notebookParam !== null ? new URL(notebookParam, window.location.href) : null;

  const notebookYaml =
    notebookUrl !== null
      ? await fetchText(notebookUrl)
      : defaultServerNotebookYaml;
  const notebook = parseNotebook(notebookYaml);

  const serverParam = url.searchParams.get("server") ?? notebook.server;
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
  const branch = url.searchParams.get("branch") ?? undefined;
  // rawGq is off by default (operator/production context); enable only via the
  // explicit `?allowRawGq` escape hatch (e.g. `view --allow-raw-gq` forwards it).
  const allowRawGq = isTruthyParam(url.searchParams.get("allowRawGq"));
  // omnigraph-server 0.7.0+ is cluster-only; reads/writes are graph-scoped.
  const graph = url.searchParams.get("graph") ?? notebook.graph;
  if (!graph) {
    throw new Error(
      "Server mode requires a graph id: top-level `graph:` or a `?graph=` URL parameter.",
    );
  }
  const client = new Client({
    baseUrl: server,
    token: readToken(),
    graphId: graph,
  });
  return {
    notebook,
    source: new ServerSource(client, {
      ...(branch ? { branch } : {}),
      ...(allowRawGq ? { allowRawGq: true } : {}),
    }),
    label: `server: ${server} · graph: ${graph}${branch ? ` · ${branch}` : ""}`,
  };
}

/** URL flag truthiness: present and not an explicit off value → true. */
function isTruthyParam(v: string | null): boolean {
  return v !== null && v !== "" && v !== "0" && v !== "false";
}

async function fetchText(url: URL): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.toString()} returned ${res.status}`);
  return res.text();
}
