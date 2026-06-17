import { parseNotebook } from "@omnigraph/notebook-spec";
import { Client, ServerSource } from "@omnigraph/client";
import type { Source } from "@omnigraph/runtime";
import { FixtureSource, parseFixture } from "@omnigraph/fixture";

import defaultServerNotebookYaml from "../../../examples/company-server.notebook.yaml?raw";
import defaultFixtureNotebookYaml from "../../../examples/company.notebook.yaml?raw";
import defaultFixtureJson from "../../../examples/fixtures/company-context.json?raw";

export interface AppConfig {
  notebook: ReturnType<typeof parseNotebook>;
  source: Source;
  label: string;
  mode: "server" | "fixture";
}

function readToken(): string | undefined {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    window.localStorage.setItem("omnigraph_token", fromUrl);
    return fromUrl;
  }
  return window.localStorage.getItem("omnigraph_token") ?? "devtoken";
}

export async function buildConfig(): Promise<AppConfig> {
  const url = new URL(window.location.href);
  const requestedMode = url.searchParams.get("mode");
  const mode =
    requestedMode === "fixture" || requestedMode === "server"
      ? requestedMode
      : undefined;
  const notebookParam = url.searchParams.get("notebook");
  const notebookUrl =
    notebookParam !== null ? new URL(notebookParam, window.location.href) : null;

  const notebookYaml =
    notebookUrl !== null
      ? await fetchText(notebookUrl)
      : mode === "fixture"
        ? defaultFixtureNotebookYaml
        : defaultServerNotebookYaml;
  const notebook = parseNotebook(notebookYaml);
  const resolvedMode: "server" | "fixture" =
    mode ?? (notebook.fixture ? "fixture" : "server");

  if (resolvedMode === "fixture") {
    if (!notebook.fixture) {
      throw new Error("Fixture mode requires top-level `fixture:` in notebook.");
    }
    const rawFixture =
      notebookUrl === null
        ? defaultFixtureJson
        : await fetchText(new URL(notebook.fixture, notebookUrl));
    const fixture = parseFixture(JSON.parse(rawFixture), notebook.fixture);
    return {
      notebook,
      source: new FixtureSource(fixture),
      label: `fixture: ${notebook.fixture}`,
      mode: "fixture",
    };
  }

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
    source: new ServerSource(client, branch ? { branch } : {}),
    label: `server: ${server} · graph: ${graph}${branch ? ` · ${branch}` : ""}`,
    mode: "server",
  };
}

async function fetchText(url: URL): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.toString()} returned ${res.status}`);
  return res.text();
}
