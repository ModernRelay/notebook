import type { Cell, CellExecution } from "@modernrelay/notebook-core";
import type { CardBox } from "./layout-overrides.js";

/**
 * The shared "label" type token — small, uppercase, muted. Used for both the
 * cell-card section titles and table column headers so they read as one family
 * (the harmonized hierarchy: quiet labels above prominent content titles).
 */
export const LABEL =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Layout tier (web host shell). Cells are tiles on a react-grid-layout canvas
 * (12 columns, fixed row height); `width`/`height` set a cell's starting box and
 * users drag/resize from there. These pure mappings stay unit-testable apart from
 * the React shell. Box overrides live in `layout-overrides.ts`. See §4.4.
 */
export const GRID_COLS = 12;
export const ROW_HEIGHT = 16;
export const GRID_MARGIN: [number, number] = [12, 12];

/** Declared `width` → react-grid-layout column count (of 12). full/absent = 12. */
export function widthToCols(width: Cell["width"]): number {
  switch (width) {
    case "two-thirds":
      return 8;
    case "half":
      return 6;
    case "third":
      return 4;
    case "full":
    case undefined:
      return 12;
  }
}

const HEIGHT_ROWS = { short: 8, medium: 13, tall: 18 } as const;

/** Declared `height` → row span, or undefined to fall back to the lens default. */
export function heightToRows(height: Cell["height"]): number | undefined {
  return height ? HEIGHT_ROWS[height] : undefined;
}

/** Per-lens default row span when a cell declares no `height`. */
export function lensDefaultRows(lens: Cell["lens"]): number {
  switch (lens) {
    case "Table":
    case "Form":
      return HEIGHT_ROWS.tall;
    case "Text":
    case "Path":
    case "Subgraph":
    case "Timeline":
    case "ActionList":
      return HEIGHT_ROWS.medium;
    case "Card":
    case "Quote":
      return HEIGHT_ROWS.short;
    case "Button":
    case "Toggle":
    case "Select":
      return 3;
    default:
      return HEIGHT_ROWS.medium;
  }
}

/** Clamp a saved box into the 12-column grid (guards stale/corrupt localStorage
 *  boxes from being handed to — and re-saved by — RGL out of bounds). */
function clampBox(b: CardBox): CardBox {
  const w = Math.min(Math.max(Math.round(b.w), 1), GRID_COLS);
  const x = Math.min(Math.max(Math.round(b.x), 0), GRID_COLS - w);
  return { x, y: Math.max(Math.round(b.y), 0), w, h: Math.max(Math.round(b.h), 1) };
}

/**
 * Build the react-grid-layout array for a tab's visible cells: a saved box if the
 * user has arranged the cell (clamped to the grid), else a generated default —
 * flowing cells left-to-right in declaration order (`w` from `width`, `h` from
 * `height`/lens default) and wrapping rows. New (unsaved) cells start *below* any
 * saved boxes so they never seed on top of an arranged card; RGL's vertical
 * compaction then tidies the result.
 */
export function buildTabLayout(
  cells: readonly CellExecution[],
  saved: Record<string, CardBox>,
): Array<{ i: string } & CardBox> {
  // Seed generated cells below the lowest saved box in this tab (0 when none),
  // so a freshly-added cell can't overlap one the user has positioned.
  let floor = 0;
  for (const ce of cells) {
    const b = saved[ce.cell.id];
    if (b) floor = Math.max(floor, clampBox(b).y + clampBox(b).h);
  }
  const out: Array<{ i: string } & CardBox> = [];
  let cx = 0;
  let cy = floor;
  let rowH = 0;
  for (const ce of cells) {
    const cell = ce.cell;
    const box = saved[cell.id];
    if (box) {
      out.push({ i: cell.id, ...clampBox(box) });
      continue;
    }
    const w = widthToCols(cell.width);
    const h = heightToRows(cell.height) ?? lensDefaultRows(cell.lens);
    if (cx + w > GRID_COLS) {
      cx = 0;
      cy += rowH;
      rowH = 0;
    }
    out.push({ i: cell.id, x: cx, y: cy, w, h });
    cx += w;
    rowH = Math.max(rowH, h);
  }
  return out;
}

/**
 * Distinct tab names a notebook declares, in cell-declaration order. The tab bar
 * renders these left-to-right. An empty array means the notebook has no tabs and
 * renders as a single canvas (today's behavior). Cells without a `tab` are *not*
 * their own tab — they fall into the first declared tab (see {@link cellTab}).
 */
export function deriveTabs(cells: readonly Cell[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cells) {
    if (c.tab && !seen.has(c.tab)) {
      seen.add(c.tab);
      out.push(c.tab);
    }
  }
  return out;
}

/**
 * The tab a cell belongs to: its own `tab` if set, else the first declared tab
 * (so untabbed cells default onto the leading tab). Returns null only when the
 * notebook declares no tabs at all.
 */
export function cellTab(cell: Cell, tabs: readonly string[]): string | null {
  return cell.tab ?? tabs[0] ?? null;
}

/**
 * Per-card color palette (host-shell appearance tier) — neutral grayscale + a
 * few accents, in picker display order. Matches the `color` enum in the Cell
 * spec. The tint *values* are the `--tint-*` CSS vars defined in `index.css`.
 */
export const CARD_COLORS = [
  "slate",
  "zinc",
  "stone",
  "blue",
  "emerald",
  "amber",
  "rose",
  "violet",
] as const;

const TINT_VAR: Record<string, string> = {
  slate: "var(--tint-slate)",
  zinc: "var(--tint-zinc)",
  stone: "var(--tint-stone)",
  blue: "var(--tint-blue)",
  emerald: "var(--tint-emerald)",
  amber: "var(--tint-amber)",
  rose: "var(--tint-rose)",
  violet: "var(--tint-violet)",
};

/**
 * The CSS value for a per-card tint name → `var(--tint-NAME)`, used as an inline
 * `--card` override on a cell (JIT-free; never a class). Unknown/absent → undefined.
 */
export function tintVar(name: string | null | undefined): string | undefined {
  return name ? TINT_VAR[name] : undefined;
}
