import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { parseNotebook } from "@omnigraph/notebook-spec";
import { Client, ServerSource } from "@omnigraph/client";
import {
  runNotebook,
  setAtPointer,
  setMutationSource,
  type NotebookExecution,
  type CellExecution,
  type Source,
} from "@omnigraph/executor";

// Notebook is bundled at build-time. For now we point at the sibling
// omnigraph-demo repo (BioHelix scenario, Hermes' review branch); a
// future iteration will load the notebook from the server itself so
// switching dashboards doesn't require a rebuild.
import notebookYaml from "../../../../omnigraph-demo/dashboard.notebook.yaml?raw";

import { webRegistry } from "./registry.js";
import { keyOf, optimisticStore } from "./optimistic-store.js";
import {
  classifyMutationError,
  type ClassifiedError,
} from "./error-classifier.js";

interface AppConfig {
  notebook: ReturnType<typeof parseNotebook>;
  source: Source;
  /** Display label for the header — the live server URL. */
  label: string;
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

function buildConfig(): AppConfig {
  const notebook = parseNotebook(notebookYaml);
  if (!notebook.server) {
    throw new Error(
      "Notebook is missing top-level `server:` URL — server mode requires it.",
    );
  }
  const client = new Client({ baseUrl: notebook.server, token: readToken() });
  const source = new ServerSource(client);
  return { notebook, source, label: notebook.server };
}

type Status =
  | { kind: "loading" }
  | { kind: "ready"; execution: NotebookExecution; runEpoch: number }
  | { kind: "fatal"; message: string };

export function App(): React.ReactElement {
  const [config] = useState<AppConfig>(() => {
    const c = buildConfig();
    setMutationSource(c.source);
    return c;
  });
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [stateModel, setStateModel] = useState<Record<string, unknown>>({});
  const [mutationError, setMutationError] = useState<ClassifiedError | null>(
    null,
  );

  // Mutation epoch — each /change call we kick off bumps this so the
  // executor re-runs against the new manifest version. Patches in the
  // optimistic-store remember which epoch they were issued at so they
  // can be reconciled once the corresponding executor run completes.
  const epochRef = useRef(0);

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

  const handlers = useMemo(
    () => ({
      mutate: async (params: Record<string, unknown>) => {
        const target_type = String(params.target_type ?? "");
        const target_id = String(params.target_id ?? "");
        const field = String(params.field ?? "");
        const value = params.value;
        const key =
          target_type && target_id && field
            ? keyOf({ target_type, target_id, field })
            : null;

        // Optimistic patch goes in BEFORE the network call — the lens
        // re-renders the next frame with the user's intended value.
        const clickedAtEpoch = epochRef.current;
        if (key) {
          optimisticStore.set({
            target_type,
            target_id,
            field,
            value,
            clickedAtEpoch,
          });
        }

        try {
          if (!config.source.mutate) {
            throw new Error("ServerSource does not support mutations");
          }
          await config.source.mutate(
            params as Parameters<NonNullable<Source["mutate"]>>[0],
          );
          setMutationError(null);
          if (key) optimisticStore.markSaved(key);
          // Bump epoch → useEffect re-runs runNotebook → fresh data
          // overrides the patch on the NEXT successful run.
          epochRef.current = Date.now();
          setStateModel((prev) => ({
            ...prev,
            __mutation_epoch__: epochRef.current,
          }));
        } catch (err) {
          if (key) optimisticStore.clear(key);
          const message = err instanceof Error ? err.message : String(err);
          setMutationError(classifyMutationError(message));
        }
      },
    }),
    [config.source],
  );

  useEffect(() => {
    let cancelled = false;
    const startedAt = epochRef.current;
    runNotebook(config.notebook, config.source, { state: stateModel })
      .then((execution) => {
        if (cancelled) return;
        setStatus({ kind: "ready", execution, runEpoch: startedAt });
        // Fresh data has landed; any patch issued before this run is
        // now redundant (server value either matches the patch — UI is
        // unchanged — or diverges, in which case server wins).
        optimisticStore.reconcile(startedAt + 1);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ kind: "fatal", message });
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
          <span className="rounded-full bg-green-900/60 px-3 py-1 font-mono text-xs uppercase tracking-wide text-green-300">
            live
          </span>
        </header>

        {status.kind === "loading" && (
          <LoadingSkeleton
            cellTitles={config.notebook.cells.map((c) => c.id)}
          />
        )}
        {status.kind === "fatal" && (
          <div className="rounded-md border border-red-800 bg-red-950/40 p-4">
            <p className="font-mono uppercase tracking-wide text-red-300">
              Failed to load notebook
            </p>
            <p className="mt-1 text-red-200">{status.message}</p>
          </div>
        )}
        {status.kind === "ready" && (
          <div className="space-y-6">
            {status.execution.cells.map((cell) => (
              <CellCard key={cell.cell.id} cell={cell} />
            ))}
          </div>
        )}

        {mutationError !== null && (
          <ErrorPanel error={mutationError} onDismiss={() => setMutationError(null)} />
        )}
      </main>
    </JSONUIProvider>
  );
}

function humanizeCellId(id: string): string {
  // recent-decisions → Recent decisions. Notebook cell ids are slugs;
  // the dashboard reads them as human titles. Lower-cased second word
  // on purpose so the title doesn't shout ("Recent Decisions").
  const spaced = id.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function CellCard({ cell }: { cell: CellExecution }): React.ReactElement {
  const isControl =
    cell.cell.lens === "Button" ||
    cell.cell.lens === "Toggle" ||
    cell.cell.lens === "Select";

  return (
    <section
      id={cell.cell.id}
      className={
        "rounded-lg border p-5 " +
        (isControl
          ? "border-zinc-700 bg-zinc-800/40"
          : "border-zinc-800 bg-zinc-900/40")
      }
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-zinc-100">
          {humanizeCellId(cell.cell.id)}
        </h2>
        {cell.error === null && cell.result !== null && (
          <span className="font-mono text-xs text-zinc-500">
            {cell.result.row_count} row{cell.result.row_count === 1 ? "" : "s"}
            {" · "}
            {cell.durationMs}ms
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

function LoadingSkeleton({
  cellTitles,
}: {
  cellTitles: string[];
}): React.ReactElement {
  return (
    <div className="space-y-6">
      {cellTitles.map((id) => (
        <section
          key={id}
          className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
        >
          <header className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-base font-medium text-zinc-400">
              {humanizeCellId(id)}
            </h2>
            <SkeletonBar w="w-20" />
          </header>
          <div className="space-y-2">
            <SkeletonBar w="w-full" />
            <SkeletonBar w="w-5/6" />
            <SkeletonBar w="w-2/3" />
          </div>
        </section>
      ))}
    </div>
  );
}

function SkeletonBar({ w }: { w: string }): React.ReactElement {
  // Two-tone pulse — the bg gives the bar a baseline, animate-pulse
  // dims it cyclically. h-3 default; callers can include h-* in `w`.
  const hasHeight = /\bh-/.test(w);
  return (
    <span
      className={
        "inline-block animate-pulse rounded bg-zinc-800 " +
        (hasHeight ? "" : "h-3 ") +
        w
      }
    />
  );
}

function ErrorPanel({
  error,
  onDismiss,
}: {
  error: ClassifiedError;
  onDismiss: () => void;
}): React.ReactElement {
  const tone =
    error.kind === "conflict"
      ? "border-amber-700 bg-amber-950/40"
      : error.kind === "permission"
        ? "border-red-700 bg-red-950/40"
        : error.kind === "network"
          ? "border-zinc-700 bg-zinc-900/60"
          : "border-red-800 bg-red-950/40";
  const titleTone =
    error.kind === "conflict"
      ? "text-amber-200"
      : error.kind === "network"
        ? "text-zinc-300"
        : "text-red-200";
  return (
    <aside
      role="alert"
      className={"mt-6 rounded-md border p-4 text-sm " + tone}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className={
              "mb-1 font-mono text-xs uppercase tracking-wide " + titleTone
            }
          >
            {error.kind}
          </p>
          <p className={"font-medium " + titleTone}>{error.title}</p>
          <p className="mt-1 text-zinc-300">{error.body}</p>
          {error.suggestion && (
            <p className="mt-2 text-zinc-400">{error.suggestion}</p>
          )}
          <details className="mt-3 text-xs text-zinc-500">
            <summary className="cursor-pointer hover:text-zinc-300">
              raw error
            </summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-zinc-400">
              {error.raw}
            </pre>
          </details>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="dismiss"
          className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
