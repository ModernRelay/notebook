import { describe, it, expect } from "vitest";
import type { CellExecution, Notebook } from "@modernrelay/notebook-core";
import {
  applyOverrides,
  effectiveColSpan,
  spanToColSpan,
  clampSpan,
  notebookKey,
  withOrder,
  withSpan,
  type LayoutOverrides,
} from "./layout-overrides.js";

const cell = (id: string): CellExecution =>
  ({ cell: { id, lens: "Card" } }) as CellExecution;
const ids = (cs: CellExecution[]): string[] => cs.map((c) => c.cell.id);
const O = (o: Partial<LayoutOverrides>): LayoutOverrides => ({
  order: [],
  spans: {},
  ...o,
});

describe("applyOverrides", () => {
  const inline = [cell("a"), cell("b"), cell("c")];

  it("is a no-op with no saved order", () => {
    expect(ids(applyOverrides(inline, O({})))).toEqual(["a", "b", "c"]);
  });

  it("reorders by saved order, appending unranked cells in natural order", () => {
    expect(ids(applyOverrides(inline, O({ order: ["c", "a"] })))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("drops saved ids no longer present (reconcile by id)", () => {
    expect(ids(applyOverrides(inline, O({ order: ["x", "b", "a"] })))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("places a brand-new (unsaved) cell after the ordered ones", () => {
    const withNew = [cell("a"), cell("b"), cell("new")];
    expect(ids(applyOverrides(withNew, O({ order: ["b", "a"] })))).toEqual([
      "b",
      "a",
      "new",
    ]);
  });
});

describe("span helpers", () => {
  it("clamps and rounds to 1–6", () => {
    expect(clampSpan(0)).toBe(1);
    expect(clampSpan(9)).toBe(6);
    expect(clampSpan(3.4)).toBe(3);
  });

  it("maps spans to literal col-span classes", () => {
    expect(spanToColSpan(1)).toBe("md:col-span-1");
    expect(spanToColSpan(4)).toBe("md:col-span-4");
    expect(spanToColSpan(99)).toBe("md:col-span-6");
  });

  it("effectiveColSpan: override wins, else declared width", () => {
    expect(effectiveColSpan({ id: "a" } as never, O({ spans: { a: 2 } }))).toBe(
      "md:col-span-2",
    );
    // no override → declared width mapping (half → col-span-3)
    expect(
      effectiveColSpan({ id: "a", width: "half" } as never, O({})),
    ).toBe("md:col-span-3");
    // no override, no width → full row
    expect(effectiveColSpan({ id: "a" } as never, O({}))).toBe("md:col-span-6");
  });
});

describe("notebookKey", () => {
  const nb = (title: string, cellIds: string[]): Notebook =>
    ({ version: 1, title, cells: cellIds.map((id) => ({ id })) }) as Notebook;

  it("is stable for the same title + cell-id set (order-independent)", () => {
    expect(notebookKey(nb("X", ["a", "b"]))).toBe(notebookKey(nb("X", ["b", "a"])));
  });

  it("changes when the cell-id set changes", () => {
    expect(notebookKey(nb("X", ["a", "b"]))).not.toBe(
      notebookKey(nb("X", ["a", "c"])),
    );
  });
});

describe("immutable updaters", () => {
  it("withOrder / withSpan don't mutate the source", () => {
    const base = O({ order: ["a"], spans: { a: 2 } });
    expect(withOrder(base, ["b", "a"]).order).toEqual(["b", "a"]);
    expect(withSpan(base, "b", 9).spans).toEqual({ a: 2, b: 6 });
    expect(base.order).toEqual(["a"]); // unchanged
    expect(base.spans).toEqual({ a: 2 });
  });
});
