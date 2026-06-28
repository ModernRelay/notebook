import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout/legacy";
import { JSONUIProvider, Renderer } from "@json-render/react";
import {
  createNotebookRuntime,
  notebookStateParams,
  readStatePointer,
  type CellExecution,
  type RuntimeSnapshot,
  type StateParam,
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
import { CopyButton } from "@/components/ui/copy-button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  EyeOffIcon,
  GripVerticalIcon,
  SearchIcon,
  TypeIcon,
} from "lucide-react";
import {
  CommandPalette,
  type CommandSection,
} from "./components/CommandPalette.js";
import { useHotkeys, type Hotkey } from "./lib/hotkeys.js";
import {
  buildTabLayout,
  CARD_COLORS,
  cellTab,
  deriveTabs,
  GRID_COLS,
  GRID_MARGIN,
  LABEL,
  ROW_HEIGHT,
  tintVar,
} from "./layout.js";
import {
  cardColor,
  clearOverrides,
  EMPTY_OVERRIDES,
  isHidden,
  loadOverrides,
  notebookKey,
  saveOverrides,
  withColor,
  withHidden,
  withLayout,
  type LayoutOverrides,
} from "./layout-overrides.js";
import {
  applyAppearance,
  loadAppearance,
  saveAppearance,
  MONO_FONTS,
  UI_FONTS,
  type Appearance,
} from "./appearance.js";
import {
  AnnotationCellProvider,
  AnnotationGlobalProvider,
  useAnnotations,
} from "./annotation-context.js";
import { annotationId } from "./annotations-store.js";
import { AnnotationPopup } from "./components/AnnotationPopup.js";
import { AnnotationPanel } from "./components/AnnotationPanel.js";

// react-grid-layout, width-measured + responsive (stacks to 1 column on narrow
// viewports). The canvas engine: drag to place, resize from edges, vertical
// compaction floats cards up to fill gaps.
const ResponsiveGrid = WidthProvider(Responsive);

/** True when an RGL layout matches a built box list (same x/y/w/h per id) — used
 *  to skip no-op `onLayoutChange` events so persisting doesn't loop into a
 *  re-render that re-fires the change. */
function sameLayout(
  a: Layout,
  b: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>,
): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(b.map((it) => [it.i, it] as const));
  for (const it of a) {
    const o = map.get(it.i);
    if (!o || o.x !== it.x || o.y !== it.y || o.w !== it.w || o.h !== it.h) {
      return false;
    }
  }
  return true;
}

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
    setOverrides(EMPTY_OVERRIDES);
    clearOverrides(layoutKey);
  }, [layoutKey]);

  // Annotate mode: flag graph entities, attach notes, copy a payload for an
  // agent. Web-local, persisted per-notebook; never writes to the graph.
  const ann = useAnnotations(config.notebook, config.label);

  // Tabs partition the one flat cell list into named pages (host-shell view
  // tier). Derived from the *declared* cells so the bar is stable across runtime
  // status. Empty ⇒ no tab bar (single canvas). State is shared across tabs, so
  // a selection on one tab drives dependent cells on another.
  const tabs = useMemo(() => deriveTabs(config.notebook.cells), [config.notebook]);
  // The live `$state` query params driving the canvas — surfaced as copyable
  // selection chips so they're visible before any click (and shared across tabs).
  const params = useMemo(
    () => notebookStateParams(config.notebook),
    [config.notebook],
  );

  // Global appearance prefs (UI/mono font + theme) — applied to <html> via CSS
  // vars + the `.dark` class, persisted per-browser. main.tsx applies the
  // initial value pre-paint; this keeps React in sync and re-applies on change.
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  const updateAppearance = useCallback((next: Appearance) => {
    setAppearance(next);
    saveAppearance(next);
    applyAppearance(next);
  }, []);
  const toggleTheme = useCallback(() => {
    updateAppearance({
      ...appearance,
      theme: appearance.theme === "dark" ? "light" : "dark",
    });
  }, [appearance, updateAppearance]);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const active =
    activeTab !== null && tabs.includes(activeTab)
      ? activeTab
      : (tabs[0] ?? null);

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

  // ⌘K "jump to cell": a target may live on an inactive tab, so switch to its
  // tab first, then scroll once it has mounted.
  const jumpToCell = useCallback(
    (id: string) => {
      const cell = config.notebook.cells.find((c) => c.id === id);
      const t = cell ? cellTab(cell, tabs) : null;
      if (t !== null && t !== active) setActiveTab(t);
      requestAnimationFrame(() => goToCell(id));
    },
    [config.notebook, tabs, active],
  );

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
        run: () => jumpToCell(c.id),
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
      <AnnotationGlobalProvider value={ann.globalValue}>
      <Shell
        header={
          <div className="sticky top-0 z-30 border-b border-border bg-background">
            <div className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <h1 className="truncate font-heading text-xl font-semibold tracking-tight text-foreground">
                {config.notebook.title}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {config.label}
                {" · "}
                {config.notebook.cells.length} cell
                {config.notebook.cells.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {overrides.hidden.length > 0 && (
                <HiddenMenu
                  hiddenIds={overrides.hidden}
                  onShow={(id) =>
                    updateOverrides(withHidden(overrides, id, false))
                  }
                  onShowAll={() =>
                    updateOverrides({ ...overrides, hidden: [] })
                  }
                />
              )}
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
                onClick={() => ann.setActive((a) => !a)}
                aria-pressed={ann.active}
                className={cn(ann.active && "border-primary text-foreground")}
              >
                {ann.active ? "Done annotating" : "Annotate"}
              </Button>
              <AppearanceMenu
                appearance={appearance}
                onChange={updateAppearance}
              />
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
            {params.length > 0 && (
              <ParamsBar params={params} state={snapshot.state} />
            )}
            {tabs.length > 0 && (
              <div className="-mb-px flex items-center gap-1 overflow-x-auto">
                {tabs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActiveTab(t)}
                    aria-pressed={active === t}
                    className={cn(
                      "shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
                      active === t
                        ? "border-primary font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
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
            // Tabs partition the canvas: render only the active tab's cells. All
            // cells still execute (shared state) — switching tabs is pure view.
            const onTab =
              active === null
                ? snapshot.cells
                : snapshot.cells.filter((c) => cellTab(c.cell, tabs) === active);
            // Hidden cells stay executed but drop out of the grid.
            const visible = onTab.filter((c) => !isHidden(c.cell.id, overrides));
            const gridLayout = buildTabLayout(visible, overrides.layout);
            return (
              // react-grid-layout: in Edit mode, drag a card by its grip handle to
              // any cell and resize from the edges; cards compact upward to fill
              // gaps. Browser-local box overrides layer over the declared flow.
              <ResponsiveGrid
                className="layout"
                layouts={{ lg: gridLayout }}
                breakpoints={{ lg: 768, xs: 0 }}
                cols={{ lg: GRID_COLS, xs: 1 }}
                rowHeight={ROW_HEIGHT}
                margin={GRID_MARGIN}
                containerPadding={[0, 0]}
                compactType="vertical"
                isDraggable={editing}
                isResizable={editing}
                isBounded
                draggableHandle=".cell-drag-handle"
                resizeHandles={["se"]}
                // Must return a *host* element: react-resizable wires the drag by
                // cloning it with onMouseDown/etc., which a custom component would
                // drop. `ref` is react-resizable's nodeRef (also React-19-safe).
                // Gate visibility on `editing` ourselves — RGL renders the handle
                // DOM even when isResizable is false.
                resizeHandle={(_axis, ref) => (
                  <span
                    ref={ref as React.Ref<HTMLSpanElement>}
                    className={cn(
                      "absolute right-0.5 bottom-0.5 z-10 flex size-4 cursor-se-resize items-center justify-center transition-opacity",
                      editing ? "opacity-70 hover:opacity-100" : "hidden",
                    )}
                  >
                    <span className="size-2.5 rounded-br-[5px] border-r-2 border-b-2 border-muted-foreground/70" />
                  </span>
                )}
                onLayoutChange={(_current, all) => {
                  // Persist only deliberate desktop edits; view-mode/mobile
                  // compaction also fires this. Skip no-op changes to avoid a
                  // feedback loop (RGL re-fires when we feed the layout back).
                  if (!editing || !all.lg) return;
                  if (sameLayout(all.lg, gridLayout)) return;
                  updateOverrides(withLayout(overrides, all.lg));
                }}
              >
                {visible.map((cell) => (
                  <div key={cell.cell.id}>
                    <CellCard
                      cell={cell}
                      editing={editing}
                      colorName={cardColor(cell.cell, overrides)}
                      onHide={() =>
                        updateOverrides(withHidden(overrides, cell.cell.id, true))
                      }
                      onColor={(name) =>
                        updateOverrides(withColor(overrides, cell.cell.id, name))
                      }
                    />
                  </div>
                ))}
              </ResponsiveGrid>
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
      {ann.pending && (
        <AnnotationPopup
          key={annotationId(ann.pending.cellId, ann.pending.draft.key)}
          pending={ann.pending}
          onSave={ann.save}
          onRemove={ann.remove}
          onClose={ann.closePopup}
        />
      )}
      {(ann.active || ann.session.items.length > 0) && (
        <AnnotationPanel
          session={ann.session}
          onInstruction={ann.setInstruction}
          onRemove={ann.remove}
          onClear={ann.clear}
          onCopy={ann.copy}
        />
      )}
      </AnnotationGlobalProvider>
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
      <div className="w-full max-w-[120rem] px-6 py-6">
        {header}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/** A row of the live `$state` query params — the current selections driving the
 *  canvas — each copyable. Shows the effective value: the live state value, or
 *  the param's declared default when nothing is selected yet. Sits in the sticky
 *  header so it's always visible and shared across tabs. */
function ParamsBar({
  params,
  state,
}: {
  params: StateParam[];
  state: Record<string, unknown>;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 text-xs">
      {params.map((p) => {
        const live = readStatePointer(state, p.pointer);
        const usingDefault = live === undefined || live === null || live === "";
        const value = usingDefault ? p.default : live;
        const text = value === undefined || value === null ? "" : String(value);
        return (
          <span
            key={p.pointer}
            className="group inline-flex items-center gap-1.5"
            title={usingDefault ? "default — no selection yet" : undefined}
          >
            <span className="text-muted-foreground">{paramLabel(p.pointer)}</span>
            <span
              className={cn(
                "font-mono",
                usingDefault ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {text || "—"}
            </span>
            <CopyButton value={text} />
          </span>
        );
      })}
    </div>
  );
}

/** "/selected" → "selected", "/filters/status" → "filters · status". */
function paramLabel(pointer: string): string {
  return pointer.replace(/^\//, "").split("/").join(" · ") || pointer;
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

function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Header control: lists hidden cells with a per-cell restore + "Show all".
 *  A minimal toggle dropdown (no popover primitive); a backdrop closes it. */
function HiddenMenu({
  hiddenIds,
  onShow,
  onShowAll,
}: {
  hiddenIds: string[];
  onShow: (id: string) => void;
  onShowAll: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground"
      >
        Hidden ({hiddenIds.length})
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
            <ul className="max-h-64 overflow-y-auto">
              {hiddenIds.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      onShow(id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{humanizeCellId(id)}</span>
                    <span className="text-xs text-muted-foreground">Show</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                onShowAll();
                setOpen(false);
              }}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
            >
              Show all
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Per-card tint picker (Edit mode): a swatch dot opening a small palette popover
 *  (default + the CARD_COLORS). Reuses the inline-dropdown pattern. */
function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (name: string | null) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const pick = (name: string | null): void => {
    onChange(name);
    setOpen(false);
  };
  return (
    <span className="relative">
      <button
        type="button"
        aria-label="Card color"
        title="Color"
        onClick={() => setOpen((o) => !o)}
        className="-ml-0.5 block size-3.5 rounded-full border border-border"
        style={{ background: tintVar(value) ?? "var(--card)" }}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 flex w-max items-center gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-lg">
            <button
              type="button"
              aria-label="Default"
              title="Default"
              onClick={() => pick(null)}
              className={cn(
                "size-5 rounded-full border border-border bg-card",
                value === null &&
                  "ring-2 ring-ring ring-offset-1 ring-offset-popover",
              )}
            />
            {CARD_COLORS.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                title={name}
                onClick={() => pick(name)}
                className={cn(
                  "size-5 rounded-full border border-border",
                  value === name &&
                    "ring-2 ring-ring ring-offset-1 ring-offset-popover",
                )}
                style={{ background: tintVar(name) }}
              />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/** Header "Appearance" menu: UI font, mono font, theme. Global + persisted. */
function AppearanceMenu({
  appearance,
  onChange,
}: {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Appearance"
        className="gap-2 text-muted-foreground"
      >
        <TypeIcon className="size-4" />
        <span className="max-sm:hidden">Appearance</span>
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-60 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <MenuGroup label="UI font">
              {UI_FONTS.map((f) => (
                <MenuOption
                  key={f.value}
                  label={f.label}
                  selected={appearance.uiFont === f.value}
                  onClick={() => onChange({ ...appearance, uiFont: f.value })}
                />
              ))}
            </MenuGroup>
            <MenuGroup label="Mono">
              {MONO_FONTS.map((f) => (
                <MenuOption
                  key={f.value}
                  label={f.label}
                  selected={appearance.monoFont === f.value}
                  onClick={() => onChange({ ...appearance, monoFont: f.value })}
                />
              ))}
            </MenuGroup>
            <MenuGroup label="Theme">
              {(["light", "dark"] as const).map((t) => (
                <MenuOption
                  key={t}
                  label={t === "light" ? "Light" : "Dark"}
                  selected={appearance.theme === t}
                  onClick={() => onChange({ ...appearance, theme: t })}
                />
              ))}
            </MenuGroup>
          </div>
        </>
      )}
    </div>
  );
}

function MenuGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-2 last:mb-0">
      <div className={cn("mb-1 px-1", LABEL)}>{label}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function MenuOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
        selected && "text-foreground",
      )}
    >
      <span>{label}</span>
      {selected && <CheckIcon className="size-4 text-foreground" />}
    </button>
  );
}

function CellCard({
  cell,
  editing = false,
  colorName,
  onHide,
  onColor,
}: {
  cell: CellExecution;
  editing?: boolean;
  /** Effective per-card tint name (declared `color` or override); null = default. */
  colorName?: string | null;
  /** Hide this cell from the canvas (Edit mode). */
  onHide?: () => void;
  /** Set/clear this cell's background tint (Edit mode). */
  onColor?: (name: string | null) => void;
}): React.ReactElement {
  const isControl =
    cell.cell.lens === "Button" ||
    cell.cell.lens === "Toggle" ||
    cell.cell.lens === "Select";

  // Per-card tint: override `--card` so `bg-card` (and tinted table footer /
  // control surfaces) follow. JIT-free — an inline CSS var, never a class.
  const tint = tintVar(colorName);
  const style = (tint ? { "--card": tint } : {}) as React.CSSProperties;

  // Fills its react-grid-layout box; overflow scrolls inside (see CellBody).
  // `data-tinted` lets index.css derive hover/selected/border from the tint.
  return (
    <div className="h-full" data-tinted={tint ? "" : undefined} style={style}>
      <Card
        id={cell.cell.id}
        className={cn(
          "h-full scroll-mt-24",
          isControl && "bg-card/60",
          editing && "ring-1 ring-border",
        )}
      >
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", LABEL)}>
            {editing && (
              // RGL drag handle (see `draggableHandle=".cell-drag-handle"`).
              <button
                type="button"
                aria-label="Drag to move"
                className="cell-drag-handle -ml-1 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
              >
                <GripVerticalIcon className="size-3.5" />
              </button>
            )}
            {editing && onHide && (
              <button
                type="button"
                aria-label="Hide card"
                title="Hide"
                onClick={onHide}
                className="-ml-1 text-muted-foreground hover:text-foreground"
              >
                <EyeOffIcon className="size-3.5" />
              </button>
            )}
            {editing && onColor && (
              <ColorPicker value={colorName ?? null} onChange={onColor} />
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
                <span className="text-xs text-muted-foreground tabular-nums">
                  {cell.result.row_count} row
                  {cell.result.row_count === 1 ? "" : "s"}
                </span>
              </CardAction>
            )
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <CellBody cell={cell} />
        </CardContent>
      </Card>
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
      {/* Fill the card's grid box and scroll overflow inside it (header stays
          fixed); overscroll-contain keeps the page from scrolling at the end. */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain transition-opacity",
          dimContent && "opacity-50",
        )}
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
          <AnnotationCellProvider
            cellId={cell.cell.id}
            lens={cell.cell.lens}
            queryRef={cell.cell.query?.ref}
          >
            <Renderer spec={cell.spec} registry={webRegistry} />
          </AnnotationCellProvider>
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
