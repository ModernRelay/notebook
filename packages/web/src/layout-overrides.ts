import type { Cell, Notebook } from "@modernrelay/notebook-core";

/**
 * Browser-local layout overrides — the interactive "arrange" layer on top of the
 * notebook's *declared* layout (`width`/`height`). The canvas is a
 * react-grid-layout grid; dragging/resizing a card writes its `{x,y,w,h}` box
 * here. Hidden cells and per-card color tints live alongside. Persisted to
 * `localStorage` per notebook; the YAML stays the source of truth and a reset
 * clears these back to the declared defaults. Web-only, host-shell-only — see
 * dash-books-canon.md §4.4. The pure functions here stay testable apart from the
 * React shell and `localStorage`.
 */
export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutOverrides {
  /** Per-cell grid box `{x,y,w,h}`; overrides the declared `width`/`height` flow. */
  layout: Record<string, CardBox>;
  /** Cell ids hidden from the canvas (still executed; just not rendered). */
  hidden: string[];
  /** Per-cell background tint name; overrides the declared `color`. */
  colors: Record<string, string>;
}

export const EMPTY_OVERRIDES: LayoutOverrides = {
  layout: {},
  hidden: [],
  colors: {},
};
const EMPTY = EMPTY_OVERRIDES;
const KEY_PREFIX = "dashbook:layout:v3:";
const V2_PREFIX = "dashbook:layout:v2:";

/**
 * Stable `localStorage` key for a notebook — the title alone. Editing the
 * notebook's cells must NOT reset the arrangement: overrides are per-cell, so
 * surviving cells keep their boxes and orphans are pruned (`pruneOverrides`).
 * (v2 keyed on title + a cell-id fingerprint, which wholesale-reset the canvas
 * on any notebook edit; `migrateV2` adopts those entries once.)
 */
export function notebookKey(notebook: Notebook): string {
  return `${KEY_PREFIX}${notebook.title}`;
}

/**
 * Validate an untrusted overrides payload (localStorage, the layout sidecar,
 * a v2 migration) into a well-formed LayoutOverrides — malformed parts drop
 * to empty rather than poisoning the canvas.
 */
export function normalizeOverrides(parsed: unknown): LayoutOverrides {
  if (typeof parsed !== "object" || parsed === null) return EMPTY;
  const o = parsed as Partial<LayoutOverrides>;
  return {
    layout: isLayoutMap(o.layout) ? o.layout : {},
    hidden: Array.isArray(o.hidden)
      ? o.hidden.filter((x): x is string => typeof x === "string")
      : [],
    colors: isColorMap(o.colors) ? o.colors : {},
  };
}

/**
 * Drop overrides for cells that no longer exist in the notebook. Applied at
 * load and before persisting, so deleted cells' boxes never accumulate or get
 * written to the sidecar.
 */
export function pruneOverrides(
  o: LayoutOverrides,
  liveIds: ReadonlySet<string>,
): LayoutOverrides {
  const layout: Record<string, CardBox> = {};
  for (const [id, box] of Object.entries(o.layout)) {
    if (liveIds.has(id)) layout[id] = box;
  }
  const colors: Record<string, string> = {};
  for (const [id, color] of Object.entries(o.colors)) {
    if (liveIds.has(id)) colors[id] = color;
  }
  return {
    layout,
    hidden: o.hidden.filter((id) => liveIds.has(id)),
    colors,
  };
}

/** The stored personal overrides, or null when this browser has none. */
export function loadOverrides(key: string): LayoutOverrides | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalizeOverrides(JSON.parse(raw));
  } catch {
    return null; // unparseable / unavailable storage → no personal layer
  }
}

/**
 * One-time adoption of a pre-v3 arrangement: on a v3 miss, find this title's
 * newest v2 entry (keyed `v2:<title>:<cell-fingerprint>`), re-home it under
 * the stable v3 key, and delete every v2 entry for the title.
 */
export function migrateV2(
  title: string,
  liveIds: ReadonlySet<string>,
): LayoutOverrides | null {
  try {
    const prefix = `${V2_PREFIX}${title}:`;
    const oldKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key !== null && key.startsWith(prefix)) oldKeys.push(key);
    }
    if (oldKeys.length === 0) return null;
    let adopted: LayoutOverrides | null = null;
    for (const key of oldKeys) {
      const raw = window.localStorage.getItem(key);
      if (adopted === null && raw) {
        const candidate = pruneOverrides(
          normalizeOverrides(JSON.parse(raw)),
          liveIds,
        );
        if (
          Object.keys(candidate.layout).length > 0 ||
          candidate.hidden.length > 0 ||
          Object.keys(candidate.colors).length > 0
        ) {
          adopted = candidate;
        }
      }
      window.localStorage.removeItem(key);
    }
    if (adopted !== null) {
      saveOverrides(`${KEY_PREFIX}${title}`, adopted);
    }
    return adopted;
  } catch {
    return null;
  }
}

export function saveOverrides(key: string, o: LayoutOverrides): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(o));
  } catch {
    /* private mode / quota — overrides are best-effort */
  }
}

export function clearOverrides(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isBox(v: unknown): v is CardBox {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.w === "number" &&
    typeof o.h === "number"
  );
}

function isLayoutMap(v: unknown): v is Record<string, CardBox> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every(isBox)
  );
}

function isColorMap(v: unknown): v is Record<string, string> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((s) => typeof s === "string")
  );
}

/**
 * Merge a set of react-grid-layout items (its `onLayoutChange` payload for the
 * active tab) into the saved box map by `i` (immutable). Boxes for cells not in
 * `items` — other tabs, hidden cells — are preserved.
 */
export function withLayout(
  o: LayoutOverrides,
  items: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>,
): LayoutOverrides {
  const layout = { ...o.layout };
  for (const it of items) {
    layout[it.i] = { x: it.x, y: it.y, w: it.w, h: it.h };
  }
  return { ...o, layout };
}

/** Is this cell currently hidden from the canvas? */
export function isHidden(id: string, o: LayoutOverrides): boolean {
  return o.hidden.includes(id);
}

/** Hide / show a cell (immutable). */
export function withHidden(
  o: LayoutOverrides,
  id: string,
  hidden: boolean,
): LayoutOverrides {
  const set = new Set(o.hidden);
  if (hidden) set.add(id);
  else set.delete(id);
  return { ...o, hidden: [...set] };
}

/** Set (or clear, with `null`) a cell's background-tint override (immutable). */
export function withColor(
  o: LayoutOverrides,
  id: string,
  color: string | null,
): LayoutOverrides {
  const colors = { ...o.colors };
  if (color) colors[id] = color;
  else delete colors[id];
  return { ...o, colors };
}

/**
 * Effective per-card tint name: the user's override if present, else the cell's
 * declared `color`, else null (default surface).
 */
export function cardColor(cell: Cell, o: LayoutOverrides): string | null {
  return o.colors[cell.id] ?? cell.color ?? null;
}
