import { describe, it, expect } from "vitest";
import type { CellExecution } from "@modernrelay/notebook-core";
import { partitionCells, readPointer, widthToColSpan } from "./layout.js";

/** Minimal CellExecution stub — partitionCells only reads `cell.cell`. */
function cell(
  id: string,
  display?: "inline" | "drawer" | "modal",
  open_state?: string,
): CellExecution {
  return { cell: { id, lens: "Card", display, open_state } } as CellExecution;
}

describe("partitionCells", () => {
  it("keeps plain cells inline", () => {
    const { inline, overlays } = partitionCells([cell("a"), cell("b")]);
    expect(inline.map((c) => c.cell.id)).toEqual(["a", "b"]);
    expect(overlays).toHaveLength(0);
  });

  it("groups cells sharing display+open_state into one overlay", () => {
    const cells = [
      cell("list"),
      cell("detail", "drawer", "/selected"),
      cell("related", "drawer", "/selected"),
    ];
    const { inline, overlays } = partitionCells(cells);
    expect(inline.map((c) => c.cell.id)).toEqual(["list"]);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.openState).toBe("/selected");
    expect(overlays[0]?.variant).toBe("drawer");
    expect(overlays[0]?.cells.map((c) => c.cell.id)).toEqual([
      "detail",
      "related",
    ]);
  });

  it("separates overlays by pointer and by variant", () => {
    const { overlays } = partitionCells([
      cell("d1", "drawer", "/a"),
      cell("d2", "drawer", "/b"),
      cell("m1", "modal", "/a"),
    ]);
    expect(overlays).toHaveLength(3);
    expect(overlays.map((o) => `${o.variant}:${o.openState}`)).toEqual([
      "drawer:/a",
      "drawer:/b",
      "modal:/a",
    ]);
  });

  it("treats a non-inline cell with no open_state as inline (nothing opens it)", () => {
    const { inline, overlays } = partitionCells([cell("x", "drawer")]);
    expect(inline.map((c) => c.cell.id)).toEqual(["x"]);
    expect(overlays).toHaveLength(0);
  });
});

describe("readPointer", () => {
  it("reads a top-level pointer", () => {
    expect(readPointer({ selected: "abc" }, "/selected")).toBe("abc");
  });

  it("reads a nested pointer and unescapes tokens", () => {
    expect(readPointer({ a: { "b/c": 1 } }, "/a/b~1c")).toBe(1);
  });

  it("returns undefined for a missing path", () => {
    expect(readPointer({}, "/nope")).toBeUndefined();
    expect(readPointer({ a: 1 }, "/a/b")).toBeUndefined();
  });

  it("returns the whole state for the empty pointer", () => {
    const state = { x: 1 };
    expect(readPointer(state, "")).toBe(state);
  });
});

describe("widthToColSpan", () => {
  it("maps each width to its literal 6-col span class", () => {
    expect(widthToColSpan("two-thirds")).toBe("md:col-span-4");
    expect(widthToColSpan("half")).toBe("md:col-span-3");
    expect(widthToColSpan("third")).toBe("md:col-span-2");
    expect(widthToColSpan("full")).toBe("md:col-span-6");
  });

  it("defaults absent width to a full row", () => {
    expect(widthToColSpan(undefined)).toBe("md:col-span-6");
  });
});
