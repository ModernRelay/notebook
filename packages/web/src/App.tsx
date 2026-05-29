import React, { useCallback, useEffect, useMemo, useState } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import {
  createNotebookRuntime,
  type CellExecution,
  type RuntimeSnapshot,
} from "@omnigraph/runtime";

import { webRegistry } from "./registry.js";
import {
  classifyMutationError,
  type ClassifiedError,
} from "./error-classifier.js";
import { buildConfig, type AppConfig } from "./config.js";

type ConfigStatus =
  | { kind: "loading" }
  | { kind: "ready"; config: AppConfig }
  | { kind: "fatal"; message: string };

export function App(): React.ReactElement {
  const [configStatus, setConfigStatus] = useState<ConfigStatus>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    buildConfig()
      .then((config) => {
        if (!cancelled) setConfigStatus({ kind: "ready", config });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConfigStatus({
            kind: "fatal",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (configStatus.kind === "loading") {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <LoadingSkeleton cellTitles={["loading"]} />
      </main>
    );
  }
  if (configStatus.kind === "fatal") {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <FatalPanel title="Failed to load notebook" message={configStatus.message} />
      </main>
    );
  }
  return <RuntimeApp config={configStatus.config} />;
}

function RuntimeApp({ config }: { config: AppConfig }): React.ReactElement {
  const [runtime] = useState(() =>
    createNotebookRuntime({ notebook: config.notebook, source: config.source }),
  );
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(() =>
    runtime.getSnapshot(),
  );
  const [dismissedMutationError, setDismissedMutationError] =
    useState<string | null>(null);

  const handleStateChange = useCallback(
    (changes: Array<{ path: string; value: unknown }>) => {
      runtime.applyStateChanges(changes);
    },
    [runtime],
  );

  const handlers = useMemo(
    () => ({
      mutate: async (params: Record<string, unknown>) => {
        setDismissedMutationError(null);
        await runtime.dispatch("mutate", { params });
      },
    }),
    [runtime],
  );

  useEffect(() => {
    const unsubscribe = runtime.subscribe(() => setSnapshot(runtime.getSnapshot()));
    return () => {
      unsubscribe();
      runtime.dispose();
    };
  }, [runtime]);

  const mutationError: ClassifiedError | null =
    snapshot.mutationError !== null &&
    snapshot.mutationError !== dismissedMutationError
      ? classifyMutationError(snapshot.mutationError)
      : null;

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
            {config.mode}
          </span>
        </header>

        {snapshot.status === "loading" && (
          <LoadingSkeleton
            cellTitles={config.notebook.cells.map((c) => c.id)}
          />
        )}
        {snapshot.status === "fatal" && (
          <FatalPanel
            title="Failed to run notebook"
            message={snapshot.error ?? "runtime failed"}
          />
        )}
        {snapshot.status === "ready" && (
          <div className="space-y-6">
            {snapshot.cells.map((cell) => (
              <CellCard key={cell.cell.id} cell={cell} />
            ))}
          </div>
        )}

        {mutationError !== null && (
          <ErrorPanel
            error={mutationError}
            onDismiss={() => setDismissedMutationError(mutationError.raw)}
          />
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

function FatalPanel({
  title,
  message,
}: {
  title: string;
  message: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-red-800 bg-red-950/40 p-4">
      <p className="font-mono uppercase tracking-wide text-red-300">
        {title}
      </p>
      <p className="mt-1 text-red-200">{message}</p>
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
