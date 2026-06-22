import type { Cell, CellExecution } from "@modernrelay/notebook-core";

/**
 * Layout tier (web host shell). Cells default to an inline vertical stack; a
 * cell with `display: drawer|modal` + an `open_state` pointer lifts into an
 * overlay that is open while that pointer is truthy in runtime state, and a
 * cell's `width` sets its span in the inline responsive grid. This module holds
 * the pure partition/pointer/width logic so it stays unit-testable apart from
 * the React shell. See dash-books-canon.md §4.4.
 */

/**
 * Map a cell `width` to its Tailwind column span in the inline 6-column grid
 * (`md:grid-cols-6`). Returns **complete literal class strings** from a lookup
 * (never interpolated) so the Tailwind JIT scanner emits them. `full`/absent →
 * a whole row; `two-thirds`/`half`/`third` divide the 6 columns evenly.
 */
export function widthToColSpan(width: Cell["width"]): string {
  switch (width) {
    case "two-thirds":
      return "md:col-span-4";
    case "half":
      return "md:col-span-3";
    case "third":
      return "md:col-span-2";
    case "full":
    case undefined:
      return "md:col-span-6";
  }
}

/** An overlay (drawer/modal) is open while its `openState` pointer is truthy. */
export interface OverlayGroup {
  openState: string;
  variant: "drawer" | "modal";
  cells: CellExecution[];
}

/**
 * Split executed cells into the inline stack and overlay groups. A cell joins
 * an overlay only when it declares both a non-inline `display` and an
 * `open_state`; cells sharing a `display`+`open_state` collapse into one
 * overlay (detail + related + … in a single drawer). Everything else —
 * including a `drawer` cell with no `open_state`, which has nothing to open it
 * — stays inline. Order is preserved within each bucket.
 */
export function partitionCells(cells: CellExecution[]): {
  inline: CellExecution[];
  overlays: OverlayGroup[];
} {
  const inline: CellExecution[] = [];
  const groups = new Map<string, OverlayGroup>();
  for (const cell of cells) {
    const display = cell.cell.display ?? "inline";
    const openState = cell.cell.open_state;
    if (display === "inline" || !openState) {
      inline.push(cell);
      continue;
    }
    const key = `${display} ${openState}`;
    const group = groups.get(key) ?? { openState, variant: display, cells: [] };
    group.cells.push(cell);
    groups.set(key, group);
  }
  return { inline, overlays: [...groups.values()] };
}

/** Read a JSON-pointer (RFC 6901) value out of runtime state; undefined if absent. */
export function readPointer(
  state: Record<string, unknown>,
  pointer: string,
): unknown {
  if (pointer === "") return state;
  if (!pointer.startsWith("/")) return undefined;
  let cur: unknown = state;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
