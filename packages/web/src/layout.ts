import type { Cell } from "@modernrelay/notebook-core";

/**
 * Layout tier (web host shell). Cells are tiles on a responsive 6-column canvas
 * grid; a cell's `width` sets its column span. This module holds the pure
 * width→class mapping so it stays unit-testable apart from the React shell.
 * Drag/resize overrides live in `layout-overrides.ts`. See dash-books-canon.md §4.4.
 */

/**
 * Map a cell `width` to its Tailwind column span in the canvas grid
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
