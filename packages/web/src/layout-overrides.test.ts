import { afterEach, describe, it, expect, vi } from "vitest";
import type { Notebook } from "@modernrelay/notebook-core";
import {
  cardColor,
  EMPTY_OVERRIDES,
  isHidden,
  loadOverrides,
  migrateV2,
  normalizeOverrides,
  notebookKey,
  pruneOverrides,
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

/** Minimal localStorage stub over a Map (key(i)/length included for migrateV2). */
function stubStorage(seed: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
  return store;
}

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
  it("uses the v3 storage namespace, keyed by title alone", () => {
    expect(notebookKey(nb("X", ["a"]))).toBe("dashbook:layout:v3:X");
  });
  it("is STABLE across cell-set changes — editing a notebook must not reset the canvas", () => {
    expect(notebookKey(nb("X", ["a", "b"]))).toBe(
      notebookKey(nb("X", ["a", "c", "d"])),
    );
  });
  it("differs between titles", () => {
    expect(notebookKey(nb("X", ["a"]))).not.toBe(notebookKey(nb("Y", ["a"])));
  });
});

describe("pruneOverrides", () => {
  it("drops layout/colors/hidden entries for cells that no longer exist", () => {
    const o = O({
      layout: {
        live: { x: 0, y: 0, w: 6, h: 8 },
        gone: { x: 6, y: 0, w: 6, h: 8 },
      },
      hidden: ["live", "gone"],
      colors: { live: "amber", gone: "rose" },
    });
    const pruned = pruneOverrides(o, new Set(["live", "other"]));
    expect(pruned).toEqual(
      O({
        layout: { live: { x: 0, y: 0, w: 6, h: 8 } },
        hidden: ["live"],
        colors: { live: "amber" },
      }),
    );
    expect(o.layout.gone).toBeDefined(); // no-mutate
  });
});

describe("normalizeOverrides", () => {
  it("accepts a well-formed payload and drops malformed parts to empty", () => {
    const good = O({ layout: { a: { x: 1, y: 2, w: 3, h: 4 } }, hidden: ["b"] });
    expect(normalizeOverrides(good)).toEqual(good);
    // a box with a non-numeric field → the whole layout map is dropped to {}
    expect(
      normalizeOverrides({ layout: { a: { x: "no", y: 0, w: 1, h: 1 } } }).layout,
    ).toEqual({});
    expect(normalizeOverrides(null)).toEqual(EMPTY_OVERRIDES);
    expect(normalizeOverrides("garbage")).toEqual(EMPTY_OVERRIDES);
    expect(normalizeOverrides({ hidden: [1, "ok"] }).hidden).toEqual(["ok"]);
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
  it("round-trips layout/hidden/colors; null on a key miss", () => {
    stubStorage();
    const o = O({
      layout: { a: { x: 1, y: 2, w: 3, h: 4 } },
      hidden: ["b"],
      colors: { c: "rose" },
    });
    saveOverrides("k", o);
    expect(loadOverrides("k")).toEqual(o);
    expect(loadOverrides("missing")).toBeNull();
  });
});

describe("migrateV2", () => {
  afterEach(() => vi.unstubAllGlobals());
  const v2 = (title: string, hash: string): string =>
    `dashbook:layout:v2:${title}:${hash}`;

  it("adopts the old arrangement under the v3 key, prunes it, and deletes v2 keys", () => {
    const arrangement = O({
      layout: {
        live: { x: 0, y: 0, w: 6, h: 8 },
        gone: { x: 6, y: 0, w: 6, h: 8 },
      },
    });
    const store = stubStorage({
      [v2("Dev", "abc123")]: JSON.stringify(arrangement),
      [v2("Other", "zzz")]: JSON.stringify(O({ hidden: ["x"] })),
    });
    const adopted = migrateV2("Dev", new Set(["live"]));
    expect(adopted).toEqual(O({ layout: { live: { x: 0, y: 0, w: 6, h: 8 } } }));
    expect(store.has(v2("Dev", "abc123"))).toBe(false); // v2 gone
    expect(store.has(v2("Other", "zzz"))).toBe(true); // other titles untouched
    expect(loadOverrides("dashbook:layout:v3:Dev")).toEqual(adopted); // re-homed
  });

  it("returns null (and stays silent) when no v2 entry exists for the title", () => {
    stubStorage();
    expect(migrateV2("Dev", new Set(["a"]))).toBeNull();
  });

  it("returns null when the v2 entry prunes to nothing (all cells renamed)", () => {
    stubStorage({
      [v2("Dev", "abc")]: JSON.stringify(
        O({ layout: { gone: { x: 0, y: 0, w: 1, h: 1 } } }),
      ),
    });
    expect(migrateV2("Dev", new Set(["new-cell"]))).toBeNull();
  });
});
