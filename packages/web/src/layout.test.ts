import { describe, it, expect } from "vitest";
import type { Cell, CellExecution } from "@modernrelay/notebook-core";
import {
  buildTabLayout,
  cellTab,
  deriveTabs,
  heightToRows,
  lensDefaultRows,
  tintVar,
  widthToCols,
} from "./layout.js";

const c = (id: string, tab?: string): Cell => ({ id, tab }) as Cell;

describe("widthToCols", () => {
  it("maps width to 12-col units; full/absent = 12", () => {
    expect(widthToCols("two-thirds")).toBe(8);
    expect(widthToCols("half")).toBe(6);
    expect(widthToCols("third")).toBe(4);
    expect(widthToCols("full")).toBe(12);
    expect(widthToCols(undefined)).toBe(12);
  });
});

describe("heightToRows / lensDefaultRows", () => {
  it("maps declared height to rows, undefined when absent", () => {
    expect(heightToRows("short")).toBe(8);
    expect(heightToRows("medium")).toBe(13);
    expect(heightToRows("tall")).toBe(18);
    expect(heightToRows(undefined)).toBeUndefined();
  });
  it("gives a per-lens default row span", () => {
    expect(lensDefaultRows("Table")).toBe(18);
    expect(lensDefaultRows("Card")).toBe(8);
    expect(lensDefaultRows("Text")).toBe(13);
    expect(lensDefaultRows("Button")).toBe(3);
  });
});

describe("deriveTabs", () => {
  it("returns [] when no cell declares a tab (single-canvas notebook)", () => {
    expect(deriveTabs([c("a"), c("b")])).toEqual([]);
  });
  it("lists distinct tabs in declaration order, de-duped", () => {
    expect(
      deriveTabs([c("a", "Explore"), c("b", "Domains"), c("c", "Explore")]),
    ).toEqual(["Explore", "Domains"]);
  });
});

describe("cellTab", () => {
  const tabs = ["Explore", "Domains"];
  it("returns the cell's own tab", () => {
    expect(cellTab(c("b", "Domains"), tabs)).toBe("Domains");
  });
  it("defaults an untabbed cell onto the first tab", () => {
    expect(cellTab(c("a"), tabs)).toBe("Explore");
  });
  it("returns null when the notebook has no tabs", () => {
    expect(cellTab(c("a"), [])).toBeNull();
  });
});

describe("tintVar", () => {
  it("maps a palette name to its --tint-* CSS var", () => {
    expect(tintVar("amber")).toBe("var(--tint-amber)");
    expect(tintVar("slate")).toBe("var(--tint-slate)");
  });
  it("returns undefined for absent / unknown names", () => {
    expect(tintVar(null)).toBeUndefined();
    expect(tintVar(undefined)).toBeUndefined();
    expect(tintVar("chartreuse")).toBeUndefined();
  });
});

describe("buildTabLayout", () => {
  const ce = (id: string, over: Partial<Cell> = {}): CellExecution =>
    ({ cell: { id, lens: "Card", ...over } }) as CellExecution;

  it("uses a saved box when present", () => {
    const out = buildTabLayout([ce("a")], { a: { x: 3, y: 4, w: 5, h: 6 } });
    expect(out).toEqual([{ i: "a", x: 3, y: 4, w: 5, h: 6 }]);
  });

  it("generates a flowing default from declared width/height + lens", () => {
    const out = buildTabLayout(
      [
        ce("a", { width: "half", height: "short" }), // w6 h8
        ce("b", { width: "half", lens: "Table" }), // w6 h18 (lens default)
        ce("c", { width: "full" }), // w12 → wraps below row 0
      ],
      {},
    );
    expect(out[0]).toEqual({ i: "a", x: 0, y: 0, w: 6, h: 8 });
    expect(out[1]).toEqual({ i: "b", x: 6, y: 0, w: 6, h: 18 });
    // row 0 height = max(8,18) = 18 → c wraps to y = 18
    expect(out[2]).toEqual({ i: "c", x: 0, y: 18, w: 12, h: 8 });
  });
});
