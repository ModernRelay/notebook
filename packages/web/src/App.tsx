import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAutoAnimate } from "@formkit/auto-animate/react";
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
import { cn } from "@/lib/utils";
import { GripVerticalIcon, SearchIcon } from "lucide-react";
import {
  CommandPalette,
  type CommandSection,
} from "./components/CommandPalette.js";
import { useHotkeys, type Hotkey } from "./lib/hotkeys.js";
import { widthToColSpan } from "./layout.js";
import {
  applyOverrides,
  clearOverrides,
  effectiveColSpan,
  loadOverrides,
  notebookKey,
  saveOverrides,
  spanToColSpan,
  withOrder,
  withSpan,
  type LayoutOverrides,
} from "./layout-overrides.js";

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

  // Layout edit mode: browser-local drag-reorder + width-resize, persisted to
  // localStorage. An override layer over the declared layout; Reset clears it.
  const [editing, setEditing] = useState(false);
  const layoutKey = useMemo(() => notebookKey(config.notebook), [config.notebook]);
  const [overrides, setOverrides] = useState<LayoutOverrides>(() =>
    loadOverrides(layoutKey),
  );
  const updateOverrides = useCallback(
    (next: LayoutOverrides) => {
      setOverrides(next);
      saveOverrides(layoutKey, next);
    },
    [layoutKey],
  );
  const resetLayout = useCallback(() => {
    setOverrides({ order: [], spans: {} });
    clearOverrides(layoutKey);
  }, [layoutKey]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Animate the canvas grid: cards FLIP into place on resize / post-reorder
  // settle / dependent-card re-resolve. Disabled during an active dnd drag so it
  // doesn't fight dnd-kit's own transforms (dnd-kit owns the drag).
  const [gridParent, enableGridAnim] = useAutoAnimate<HTMLDivElement>();

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
        header={
          <div className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border bg-background py-4">
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
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetLayout}
                  className="text-muted-foreground"
                >
                  Reset
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing((e) => !e)}
                aria-pressed={editing}
                className={cn(editing && "border-primary text-foreground")}
              >
                {editing ? "Done" : "Edit layout"}
              </Button>
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
            // One canvas: every cell is a tile in the responsive 6-column grid.
            // Dependent cells (queries reading `$state`) re-resolve in place when
            // a selection changes — no overlay. Browser-local drag/resize
            // overrides (order + width) layer over the declared layout.
            const ordered = applyOverrides(snapshot.cells, overrides);
            const orderedIds = ordered.map((c) => c.cell.id);
            const handleDragEnd = (e: DragEndEvent): void => {
              enableGridAnim(true); // dnd-kit handled the drag; animate the settle
              const { active, over } = e;
              if (!over || active.id === over.id) return;
              const from = orderedIds.indexOf(String(active.id));
              const to = orderedIds.indexOf(String(over.id));
              if (from < 0 || to < 0) return;
              updateOverrides(withOrder(overrides, arrayMove(orderedIds, from, to)));
            };
            return (
              // In edit mode, drag a cell's handle to reorder and its right edge
              // to resize. Collapses to one column below md.
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={() => enableGridAnim(false)}
                onDragCancel={() => enableGridAnim(true)}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
                  <div
                    ref={gridParent}
                    className="grid grid-cols-1 items-start gap-6 md:grid-cols-6"
                  >
                    {ordered.map((cell) => (
                      <CellCard
                        key={cell.cell.id}
                        cell={cell}
                        editing={editing}
                        colSpanClass={effectiveColSpan(cell.cell, overrides)}
                        onResize={(span) =>
                          updateOverrides(withSpan(overrides, cell.cell.id, span))
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
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
/** App shell: a single full-width centered column. The header is sticky; cell
 *  navigation lives in the ⌘K palette (no always-on sidebar). */
function Shell({
  children,
  header,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[96rem] px-6 py-10">
        {header}
        <div className="mt-8">{children}</div>
      </div>
    </div>
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

function CellCard({
  cell,
  editing = false,
  colSpanClass,
  onResize,
}: {
  cell: CellExecution;
  editing?: boolean;
  /** Effective inline col-span class (declared width or a resize override). */
  colSpanClass?: string;
  /** Commit a resize (1–6 columns); absent in non-editable contexts. */
  onResize?: (span: number) => void;
}): React.ReactElement {
  const isControl =
    cell.cell.lens === "Button" ||
    cell.cell.lens === "Toggle" ||
    cell.cell.lens === "Select";

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cell.cell.id, disabled: !editing });
  // Live width preview while dragging the resize handle (committed on pointerup).
  const [previewSpan, setPreviewSpan] = useState<number | null>(null);

  const span =
    previewSpan !== null
      ? spanToColSpan(previewSpan)
      : (colSpanClass ?? widthToColSpan(cell.cell.width));

  return (
    <div
      ref={setNodeRef}
      data-cell-root
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative min-w-0", span, isDragging && "z-10")}
    >
      <Card
        id={cell.cell.id}
        className={cn(
          "scroll-mt-24",
          isControl && "bg-card/60",
          editing && "ring-1 ring-border",
          isDragging && "opacity-80 shadow-lg",
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {editing && (
              <button
                type="button"
                aria-label="Drag to reorder"
                className="-ml-1 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
                {...attributes}
                {...listeners}
              >
                <GripVerticalIcon className="size-4" />
              </button>
            )}
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
      {editing && onResize && (
        <ResizeHandle
          onPreview={setPreviewSpan}
          onCommit={(s) => {
            setPreviewSpan(null);
            onResize(s);
          }}
        />
      )}
    </div>
  );
}

/**
 * Right-edge width-resize handle. Raw pointer events (no resize lib): maps the
 * pointer's x, relative to the cell's left, onto the 6-column grid and snaps to
 * a 1–6 span — live-previewing during the drag, committing on release. Sits
 * inside a `data-cell-root` wrapper whose parent is the grid.
 */
function ResizeHandle({
  onPreview,
  onCommit,
}: {
  onPreview: (span: number) => void;
  onCommit: (span: number) => void;
}): React.ReactElement {
  const last = useRef(6);
  const spanFor = (clientX: number, handle: HTMLElement): number => {
    const root = handle.closest("[data-cell-root]") as HTMLElement | null;
    const grid = root?.parentElement;
    if (!root || !grid) return last.current;
    const gap = parseFloat(getComputedStyle(grid).columnGap || "0") || 0;
    const cols = 6;
    const colW = (grid.clientWidth - gap * (cols - 1)) / cols;
    const widthPx = clientX - root.getBoundingClientRect().left;
    const span = Math.max(
      1,
      Math.min(cols, Math.round((widthPx + gap) / (colW + gap))),
    );
    last.current = span;
    return span;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize width"
      className="absolute right-0 top-0 hidden h-full w-3 cursor-col-resize touch-none select-none md:block"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        // rAF-coalesce: at most one preview update per frame for a fluid resize.
        let raf = 0;
        let pendingX = e.clientX;
        const move = (ev: PointerEvent): void => {
          pendingX = ev.clientX;
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            onPreview(spanFor(pendingX, handle));
          });
        };
        const up = (ev: PointerEvent): void => {
          if (raf) cancelAnimationFrame(raf);
          handle.releasePointerCapture(e.pointerId);
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          onCommit(spanFor(ev.clientX, handle));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
      }}
    >
      <div className="absolute right-0.5 top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-border" />
    </div>
  );
}

/**
 * A cell's interior — inline filter controls + the lens output, with the
 * pending/error/skeleton states. Rendered inside `CellCard`.
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
