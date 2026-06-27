import { afterEach, describe, it, expect, vi } from "vitest";
import type { Notebook } from "@modernrelay/notebook-core";
import {
  cardColor,
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

const O = (o: Partial<LayoutOverrides>): LayoutOverrides => ({
  layout: {},
  hidden: [],
  colors: {},
  ...o,
});

describe("withLayout", () => {
  it("merges RGL items by `i`, preserving other boxes; no-mutate", () => {
    const base = O({ layout: { a: { x: 0, y: 0, w: 6, h: 8 } } });
    const next = withLayout(base, [
      { i: "a", x: 2, y: 1, w: 4, h: 5 },
      { i: "b", x: 0, y: 6, w: 12, h: 10 },
    ]);
    expect(next.layout).toEqual({
      a: { x: 2, y: 1, w: 4, h: 5 },
      b: { x: 0, y: 6, w: 12, h: 10 },
    });
    expect(base.layout).toEqual({ a: { x: 0, y: 0, w: 6, h: 8 } }); // unchanged
  });
});

describe("EMPTY_OVERRIDES", () => {
  it("is an empty layout/hidden/colors", () => {
    expect(EMPTY_OVERRIDES).toEqual({ layout: {}, hidden: [], colors: {} });
  });
});

describe("notebookKey", () => {
  const nb = (title: string, ids: string[]): Notebook =>
    ({ version: 1, title, cells: ids.map((id) => ({ id })) }) as Notebook;
  it("uses the v2 storage namespace for RGL box layouts", () => {
    expect(notebookKey(nb("X", ["a"]))).toMatch(/^dashbook:layout:v2:X:/);
  });
  it("is stable for the same title + cell-id set (order-independent)", () => {
    expect(notebookKey(nb("X", ["a", "b"]))).toBe(
      notebookKey(nb("X", ["b", "a"])),
    );
  });
  it("changes when the cell-id set changes", () => {
    expect(notebookKey(nb("X", ["a", "b"]))).not.toBe(
      notebookKey(nb("X", ["a", "c"])),
    );
  });
});

describe("hidden", () => {
  it("withHidden adds/removes (idempotent); isHidden reflects it", () => {
    let o = O({});
    expect(isHidden("a", o)).toBe(false);
    o = withHidden(o, "a", true);
    expect(o.hidden).toEqual(["a"]);
    expect(isHidden("a", o)).toBe(true);
    o = withHidden(o, "a", true);
    expect(o.hidden).toEqual(["a"]);
    o = withHidden(o, "a", false);
    expect(o.hidden).toEqual([]);
  });
  it("withHidden doesn't mutate the source", () => {
    const base = O({ hidden: ["a"] });
    withHidden(base, "b", true);
    expect(base.hidden).toEqual(["a"]);
  });
});

describe("colors", () => {
  it("withColor sets and clears a tint; no-mutate", () => {
    const base = O({});
    const a = withColor(base, "x", "amber");
    expect(a.colors).toEqual({ x: "amber" });
    expect(base.colors).toEqual({});
    expect(withColor(a, "x", null).colors).toEqual({});
  });
  it("cardColor: override wins, else declared color, else null", () => {
    const cell = { id: "x", color: "blue" } as never;
    expect(cardColor(cell, O({ colors: { x: "amber" } }))).toBe("amber");
    expect(cardColor(cell, O({}))).toBe("blue");
    expect(cardColor({ id: "y" } as never, O({}))).toBeNull();
  });
});

describe("loadOverrides", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("round-trips layout/hidden/colors and rejects a malformed layout", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    });
    const o = O({
      layout: { a: { x: 1, y: 2, w: 3, h: 4 } },
      hidden: ["b"],
      colors: { c: "rose" },
    });
    saveOverrides("k", o);
    expect(loadOverrides("k")).toEqual(o);
    // a box with a non-numeric field → the whole layout map is dropped to {}
    store.set("k2", JSON.stringify({ layout: { a: { x: "no", y: 0, w: 1, h: 1 } } }));
    expect(loadOverrides("k2").layout).toEqual({});
  });
});
