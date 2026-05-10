import React, { useCallback, useEffect, useMemo, useState } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { parseNotebook, type Notebook } from "@omnigraph/notebook-spec";
import { parseFixture, FixtureSource } from "@omnigraph/fixture";
import { Client, ServerSource } from "@omnigraph/client";
import {
  runNotebook,
  setAtPointer,
  setMutationSource,
  type NotebookExecution,
  type CellExecution,
  type Source,
} from "@omnigraph/executor";

// Both notebook YAML files are inlined at build time. The mode picker
// (URL ?mode=server) chooses which one drives the App, then the Source
// instantiation routes reads/mutations through fixture or HTTP.
import fixtureNotebookYaml from "../../../examples/company.notebook.yaml?raw";
import serverNotebookYaml from "../../../examples/company-server.notebook.yaml?raw";
import fixtureJson from "../../../examples/fixtures/company-context.json";

import { webRegistry } from "./registry.js";

type Mode = "fixture" | "server";

interface AppConfig {
  mode: Mode;
  notebook: Notebook;
  source: Source;
  /** Display label for the header — fixture path or server URL. */
  label: string;
}

function readMode(): Mode {
  const url = new URL(window.location.href);
  return url.searchParams.get("mode") === "server" ? "server" : "fixture";
}

function readToken(): string | undefined {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    // Tokens land in localStorage so a refresh keeps the session alive
    // without re-typing in the URL bar.
    window.localStorage.setItem("omnigraph_token", fromUrl);
    return fromUrl;
  }
  return window.localStorage.getItem("omnigraph_token") ?? "devtoken";
}

function buildConfig(): AppConfig {
  const mode = readMode();
  if (mode === "server") {
    const notebook = parseNotebook(serverNotebookYaml);
    if (!notebook.server) {
      throw new Error(
        "company-server.notebook.yaml is missing top-level `server:` URL",
      );
    }
    const client = new Client({ baseUrl: notebook.server, token: readToken() });
    const source = new ServerSource(client);
    return { mode, notebook, source, label: `server: ${notebook.server}` };
  }
  const notebook = parseNotebook(fixtureNotebookYaml);
  const source = new FixtureSource(
    parseFixture(fixtureJson, "company-context.json"),
  );
  return {
    mode,
    notebook,
    source,
    label: `fixture: ${notebook.fixture ?? "company-context.json"}`,
  };
}

type Status =
  | { kind: "loading" }
  | { kind: "ready"; execution: NotebookExecution }
  | { kind: "fatal"; message: string };

export function App(): React.ReactElement {
  const [config] = useState<AppConfig>(() => {
    const c = buildConfig();
    setMutationSource(c.source);
    return c;
  });
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [stateModel, setStateModel] = useState<Record<string, unknown>>({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  const handleStateChange = useCallback(
    (changes: Array<{ path: string; value: unknown }>) => {
      setStateModel((prev) => {
        let next = prev;
        for (const { path, value } of changes) {
          next = setAtPointer(next, path, value);
        }
        return next;
      });
    },
    [],
  );

  // mirror of TUI: handlers must NOT throw — json-render's executeAction
  // re-raises, and an unhandled rejection in a click breaks every other
  // interaction. Catch + render inline + bump epoch on success.
  const handlers = useMemo(
    () => ({
      mutate: async (params: Record<string, unknown>) => {
        try {
          const src = config.source;
          if (!src.mutate) {
            throw new Error(
              "current source does not support mutations (fixture without mutate?)",
            );
          }
          await src.mutate(params as Parameters<typeof src.mutate>[0]);
          setMutationError(null);
          setStateModel((prev) => ({ ...prev, __mutation_epoch__: Date.now() }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setMutationError(condenseMutationError(message));
        }
      },
    }),
    [config.source],
  );

  useEffect(() => {
    let cancelled = false;
    runNotebook(config.notebook, config.source, { state: stateModel })
      .then((execution) => {
        if (!cancelled) setStatus({ kind: "ready", execution });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus({ kind: "fatal", message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config.notebook, config.source, stateModel]);

  return (
    <JSONUIProvider
      registry={webRegistry}
      initialState={{}}
      onStateChange={handleStateChange}
      handlers={handlers}
    >
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8 flex items-baseline justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
              {config.notebook.title}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {config.label}
              {" · "}
              {config.notebook.cells.length} cell
              {config.notebook.cells.length === 1 ? "" : "s"}
            </p>
          </div>
          <ModeBadge mode={config.mode} />
        </header>

        {status.kind === "loading" && (
          <p className="text-zinc-500">Running notebook…</p>
        )}
        {status.kind === "fatal" && (
          <p className="rounded-md bg-red-900/40 p-4 text-red-200">
            fatal: {status.message}
          </p>
        )}
        {status.kind === "ready" && (
          <div className="space-y-8">
            {status.execution.cells.map((cell) => (
              <CellCard key={cell.cell.id} cell={cell} />
            ))}
          </div>
        )}

        {mutationError !== null && (
          <aside className="mt-6 rounded-md border border-red-800 bg-red-950/40 p-4 text-sm">
            <p className="mb-1 font-mono uppercase tracking-wide text-red-300">
              mutation error
            </p>
            <p className="font-mono text-red-200">{mutationError}</p>
          </aside>
        )}

        <ApprovalsBadge state={stateModel} />
      </main>
    </JSONUIProvider>
  );
}

function ModeBadge({ mode }: { mode: Mode }): React.ReactElement {
  // Single switch surface: the badge links to the OTHER mode so the user
  // can flip without typing query params manually.
  const target = mode === "server" ? "" : "?mode=server";
  return (
    <a
      href={target}
      className={
        "rounded-full px-3 py-1 text-xs font-mono uppercase tracking-wide " +
        (mode === "server"
          ? "bg-green-900/60 text-green-300 hover:bg-green-900"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700")
      }
      title={
        mode === "server"
          ? "server-backed (live omnigraph). Click for fixture mode."
          : "fixture-backed (in-memory). Click for server mode."
      }
    >
      {mode === "server" ? "server" : "fixture"}
    </a>
  );
}

function CellCard({ cell }: { cell: CellExecution }): React.ReactElement {
  const isControl =
    cell.cell.lens === "Button" ||
    cell.cell.lens === "Toggle" ||
    cell.cell.lens === "Select";

  return (
    <section
      className={
        "rounded-lg border p-5 " +
        (isControl
          ? "border-zinc-700 bg-zinc-800/40"
          : "border-zinc-800 bg-zinc-900/40")
      }
    >
      <header className="mb-3 flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <code className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
            {cell.cell.id}
          </code>
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            {cell.cell.lens}
          </span>
        </div>
        {cell.error === null && cell.result !== null && (
          <span className="font-mono text-xs text-zinc-500">
            {cell.result.row_count} row(s) · {cell.durationMs}ms
          </span>
        )}
      </header>
      {cell.controlSpecs.length > 0 && (
        <div className="mb-3 space-y-2">
          {cell.controlSpecs.map((spec) => (
            <Renderer key={spec.root} spec={spec} registry={webRegistry} />
          ))}
        </div>
      )}
      {cell.error !== null && (
        <p className="rounded bg-red-900/40 p-3 font-mono text-xs text-red-200">
          {cell.error.message}
        </p>
      )}
      {cell.error === null && cell.spec !== null && (
        <Renderer spec={cell.spec} registry={webRegistry} />
      )}
    </section>
  );
}

function ApprovalsBadge({
  state,
}: {
  state: Record<string, unknown>;
}): React.ReactElement | null {
  const approvals = (state.approvals as Record<string, string> | undefined) ?? {};
  const entries = Object.entries(approvals);
  if (entries.length === 0) return null;
  return (
    <aside className="mt-8 rounded-md border border-zinc-800 bg-zinc-900/60 p-4 text-xs">
      <p className="mb-1 uppercase tracking-wide text-zinc-500">Approvals (in-memory)</p>
      <ul className="font-mono text-zinc-300">
        {entries.map(([id, status]) => (
          <li key={id}>
            <span className="text-zinc-500">{id}</span> · {status}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function condenseMutationError(raw: string): string {
  const match = raw.match(/^(omnigraph-server\s+\S+\s+returned\s+\d+:\s+)?(\{.*"error":"([^"]*)")/);
  if (match) {
    const inner = match[3]!;
    return inner.replace(/,\s+\/[^\s]+\.rs:\d+:\d+/, "").trim();
  }
  return raw.split("\n")[0]!.slice(0, 240);
}
