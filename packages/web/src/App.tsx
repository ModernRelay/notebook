import React, { useCallback, useEffect, useMemo, useState } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import {
  createNotebookRuntime,
  type CellExecution,
  type RuntimeSnapshot,
} from "@modernrelay/notebook-core";

import { webRegistry } from "./registry.js";
import {
  classifyMutationError,
  type ClassifiedError,
  type ErrorKind,
} from "./error-classifier.js";
import { buildConfig, type AppConfig } from "./config.js";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Overlay } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { SearchIcon } from "lucide-react";
import {
  CommandPalette,
  type CommandSection,
} from "./components/CommandPalette.js";
import { useHotkeys, type Hotkey } from "./lib/hotkeys.js";
import { partitionCells, readPointer, widthToColSpan } from "./layout.js";

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
      <Shell>
        <LoadingSkeleton cellTitles={["loading"]} />
      </Shell>
    );
  }
  if (configStatus.kind === "fatal") {
    return (
      <Shell>
        <FatalPanel
          title="Failed to load notebook"
          message={configStatus.message}
        />
      </Shell>
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
  const [dismissedMutationError, setDismissedMutationError] = useState<
    string | null
  >(null);
  const [cmdOpen, setCmdOpen] = useState(false);

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
    const unsubscribe = runtime.subscribe(() =>
      setSnapshot(runtime.getSnapshot()),
    );
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

  const navCells = (
    snapshot.status === "ready" ? snapshot.cells.map((c) => c.cell) : config.notebook.cells
  ).map((c) => ({ id: c.id }));

  // ⌘K command palette: grouped sections — jump to any cell, plus global
  // actions. Each row's `chord` is the single source for both its badge and its
  // global binding (wired by useHotkeys below). The first nine cells get ⌥1–⌥9.
  const commandSections: CommandSection[] = [
    {
      value: "Cells",
      items: navCells.map((c, i) => ({
        value: `cell:${c.id}`,
        label: humanizeCellId(c.id),
        chord: i < 9 ? { alt: true, code: `Digit${i + 1}` } : undefined,
        run: () => goToCell(c.id),
      })),
    },
    {
      value: "Actions",
      items: [
        {
          value: "action:toggle-theme",
          label: "Toggle light / dark theme",
          chord: { meta: true, code: "KeyD" },
          run: toggleTheme,
        },
        {
          value: "action:scroll-top",
          label: "Scroll to top",
          chord: { meta: true, code: "ArrowUp" },
          run: scrollToTop,
        },
      ],
    },
  ];

  // One listener for every shortcut: ⌘K toggles the palette, plus each action's
  // own chord (defined once on the action, reused for badge + binding).
  const hotkeys: Hotkey[] = [
    { chord: { meta: true, code: "KeyK" }, run: () => setCmdOpen((o) => !o) },
    ...commandSections
      .flatMap((section) => section.items)
      .flatMap((item) => (item.chord ? [{ chord: item.chord, run: item.run }] : [])),
  ];
  useHotkeys(hotkeys);

  return (
    <JSONUIProvider
      registry={webRegistry}
      initialState={{}}
      onStateChange={handleStateChange}
      handlers={handlers}
    >
      <Shell
        nav={<Sidebar cells={navCells} />}
        header={
          <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
            <div className="min-w-0">
              <h1 className="truncate font-heading text-2xl font-semibold tracking-tight text-foreground">
                {config.notebook.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {config.label}
                {" · "}
                {config.notebook.cells.length} cell
                {config.notebook.cells.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCmdOpen(true)}
                aria-label="Open command palette"
                className="gap-2 text-muted-foreground"
              >
                <SearchIcon className="size-4" />
                <span className="max-sm:hidden">Search</span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none">
                  ⌘K
                </kbd>
              </Button>
              <Badge variant="outline" className="font-mono uppercase">
                server
              </Badge>
            </div>
          </div>
        }
      >
        {snapshot.status === "loading" && (
          <LoadingSkeleton cellTitles={config.notebook.cells.map((c) => c.id)} />
        )}
        {snapshot.status === "fatal" && (
          <FatalPanel
            title="Failed to run notebook"
            message={snapshot.error ?? "runtime failed"}
          />
        )}
        {snapshot.status === "ready" &&
          (() => {
            // Layout tier: most cells stack inline; cells with `display:
            // drawer|modal` lift into an overlay keyed by their `open_state`
            // pointer (cells sharing a pointer share one overlay). The overlay
            // is open while that pointer is truthy in runtime state — the same
            // `/selected` a Table writes on row click — and close clears it.
            const { inline, overlays } = partitionCells(snapshot.cells);
            return (
              <>
                {/* Inline cells flow in a responsive 6-column grid; each cell
                    spans per its `width` (default full = its own row, so the
                    no-width case is the old single-column stack). Collapses to
                    one column below md. */}
                <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-6">
                  {inline.map((cell) => (
                    <CellCard key={cell.cell.id} cell={cell} />
                  ))}
                </div>
                {overlays.map((group) => {
                  const selected = readPointer(snapshot.state, group.openState);
                  const title =
                    typeof selected === "string" && selected
                      ? humanizeCellId(selected)
                      : "Details";
                  return (
                    <Overlay
                      key={`${group.variant}:${group.openState}`}
                      open={Boolean(selected)}
                      variant={group.variant}
                      title={title}
                      onClose={() =>
                        runtime.applyStateChanges([
                          { path: group.openState, value: "" },
                        ])
                      }
                    >
                      <div className="space-y-6">
                        {group.cells.map((cell) => (
                          <section key={cell.cell.id} className="space-y-3">
                            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {humanizeCellId(cell.cell.id)}
                            </h3>
                            <CellBody cell={cell} />
                          </section>
                        ))}
                      </div>
                    </Overlay>
                  );
                })}
              </>
            );
          })()}

        {mutationError !== null && (
          <ErrorPanel
            error={mutationError}
            onDismiss={() => setDismissedMutationError(mutationError.raw)}
          />
        )}
      </Shell>
      <CommandPalette
        open={cmdOpen}
        setOpen={setCmdOpen}
        sections={commandSections}
      />
    </JSONUIProvider>
  );
}

/** App shell: centered column with an optional left cell-nav and header. */
function Shell({
  children,
  nav,
  header,
}: {
  children: React.ReactNode;
  nav?: React.ReactNode;
  header?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-10">
        {nav}
        <main className="min-w-0 flex-1">
          {header}
          <div className="mt-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  cells,
}: {
  cells: Array<{ id: string }>;
}): React.ReactElement {
  return (
    <nav className="sticky top-10 hidden h-fit w-52 shrink-0 lg:block">
      <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Cells
      </p>
      <ul className="space-y-0.5">
        {cells.map((c) => (
          <li key={c.id}>
            <a
              href={`#${c.id}`}
              className="block truncate rounded-md px-3 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {humanizeCellId(c.id)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function humanizeCellId(id: string): string {
  // recent-decisions → Recent decisions. Notebook cell ids are slugs;
  // the dashboard reads them as human titles. Lower-cased second word
  // on purpose so the title doesn't shout ("Recent Decisions").
  const spaced = id.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Smooth-scroll a cell Card into view (cells render with `id={cell.id}`). */
function goToCell(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
}

function toggleTheme(): void {
  document.documentElement.classList.toggle("dark");
}

function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function CellCard({ cell }: { cell: CellExecution }): React.ReactElement {
  const isControl =
    cell.cell.lens === "Button" ||
    cell.cell.lens === "Toggle" ||
    cell.cell.lens === "Select";

  return (
    <Card
      id={cell.cell.id}
      className={cn(
        "scroll-mt-10",
        widthToColSpan(cell.cell.width),
        isControl && "bg-card/60",
      )}
    >
      <CardHeader>
        <CardTitle className="text-base">
          {humanizeCellId(cell.cell.id)}
        </CardTitle>
        {cell.pending ? (
          <CardAction>
            <UpdatingIndicator />
          </CardAction>
        ) : (
          cell.error === null &&
          cell.result !== null && (
            <CardAction>
              <Badge variant="outline" size="sm" className="font-mono">
                {cell.result.row_count} row
                {cell.result.row_count === 1 ? "" : "s"}
                {" · "}
                {cell.durationMs}ms
              </Badge>
            </CardAction>
          )
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <CellBody cell={cell} />
      </CardContent>
    </Card>
  );
}

/**
 * A cell's interior — inline filter controls + the lens output, with the
 * pending/error/skeleton states. Shared by the inline `CellCard` and the
 * overlay drawer so both render identically.
 *
 * Re-querying (filter change / mutation re-run) keeps the previous spec
 * visible; we dim the lens output and show an "updating…" cue while the inline
 * controls stay crisp. A failed re-read also keeps the stale spec, shown dimmed
 * beneath the error.
 */
function CellBody({ cell }: { cell: CellExecution }): React.ReactElement {
  const dimContent = (cell.pending || cell.error !== null) && cell.spec !== null;
  return (
    <>
      {cell.controlSpecs.length > 0 && (
        <div className="space-y-2">
          {cell.controlSpecs.map((spec) => (
            <Renderer key={spec.root} spec={spec} registry={webRegistry} />
          ))}
        </div>
      )}
      <div
        className={cn("transition-opacity", dimContent && "opacity-50")}
        aria-busy={cell.pending || undefined}
      >
        {cell.error !== null && (
          <Alert variant="error" className="mb-3">
            <AlertDescription className="font-mono text-xs">
              {cell.error.message}
            </AlertDescription>
          </Alert>
        )}
        {cell.spec !== null && (
          <Renderer spec={cell.spec} registry={webRegistry} />
        )}
        {cell.error === null && cell.spec === null && cell.pending && (
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}
      </div>
    </>
  );
}

function UpdatingIndicator(): React.ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
      updating…
    </span>
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
        <Card key={id}>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              {humanizeCellId(id)}
            </CardTitle>
            <CardAction>
              <Skeleton className="h-4 w-20" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </CardContent>
        </Card>
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
    <Alert variant="error">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

const ALERT_VARIANT: Record<ErrorKind, "error" | "warning" | "info" | "default"> =
  {
    conflict: "warning",
    permission: "error",
    validation: "warning",
    network: "default",
    engine: "error",
    unknown: "error",
  };

function ErrorPanel({
  error,
  onDismiss,
}: {
  error: ClassifiedError;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <Alert variant={ALERT_VARIANT[error.kind]} className="mt-6">
      <AlertTitle>
        <span className="mr-2 font-mono text-xs uppercase tracking-wide text-muted-foreground">
          {error.kind}
        </span>
        {error.title}
      </AlertTitle>
      <AlertDescription>
        <span>{error.body}</span>
        {error.suggestion && (
          <span className="text-muted-foreground">{error.suggestion}</span>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            raw error
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono">
            {error.raw}
          </pre>
        </details>
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="dismiss"
          onClick={onDismiss}
        >
          ✕
        </Button>
      </AlertAction>
    </Alert>
  );
}
