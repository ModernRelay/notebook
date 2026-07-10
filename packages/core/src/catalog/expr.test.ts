import { describe, it, expect } from "vitest";
import { evaluateExpr } from "./expr.js";
import { applyTableDerivations, TableAuthorPropsSchema } from "./lenses/table.js";

const NOW = Date.parse("2026-07-09T12:00:00Z");

describe("evaluateExpr", () => {
  const row = { score: "0.62", posted: "2026-07-06", empty: "" };

  it("does arithmetic with precedence and parens", () => {
    expect(evaluateExpr("1 + 2 * 3", { row, nowMs: NOW })).toBe(7);
    expect(evaluateExpr("(1 + 2) * 3", { row, nowMs: NOW })).toBe(9);
    expect(evaluateExpr("-2 * 3", { row, nowMs: NOW })).toBe(-6);
  });

  it("num() reads a row field as a number", () => {
    expect(evaluateExpr('num("score") * 2', { row, nowMs: NOW })).toBeCloseTo(1.24);
  });

  it("days_since() measures from a bare date (UTC midnight) to now", () => {
    // 2026-07-06T00:00 → 2026-07-09T12:00 = 3.5 days
    expect(evaluateExpr('days_since("posted")', { row, nowMs: NOW })).toBeCloseTo(3.5);
  });

  it("days_since() accepts Z-less datetimes as UTC", () => {
    const r = { at: "2026-07-08T12:00:00" };
    expect(evaluateExpr('days_since("at")', { row: r, nowMs: NOW })).toBeCloseTo(1);
  });

  it("tier() picks the first threshold the value fits under", () => {
    const src = "tier(num(\"x\"), 1, 1.0, 3, 0.75, 7, 0.55, 0.05)";
    expect(evaluateExpr(src, { row: { x: 0.5 }, nowMs: NOW })).toBe(1.0);
    expect(evaluateExpr(src, { row: { x: 3 }, nowMs: NOW })).toBe(0.75);
    expect(evaluateExpr(src, { row: { x: 5 }, nowMs: NOW })).toBe(0.55);
    expect(evaluateExpr(src, { row: { x: 99 }, nowMs: NOW })).toBe(0.05);
  });

  it("tier() blanks instead of returning the default when x is not numeric", () => {
    const src = "tier(num(\"x\"), 1, 1.0, 3, 0.75, 0.05)";
    expect(evaluateExpr(src, { row: { x: true }, nowMs: NOW })).toBeNull();
    expect(evaluateExpr(src, { row: {}, nowMs: NOW })).toBeNull();
  });

  it("returns null instead of NaN/throwing on bad input", () => {
    expect(evaluateExpr('num("missing")', { row, nowMs: NOW })).toBeNull();
    expect(evaluateExpr('num("empty")', { row, nowMs: NOW })).toBeNull();
    expect(evaluateExpr('num("flag")', { row: { flag: true }, nowMs: NOW })).toBeNull();
    expect(evaluateExpr('num("blank")', { row: { blank: "   " }, nowMs: NOW })).toBeNull();
    expect(evaluateExpr('days_since("empty")', { row, nowMs: NOW })).toBeNull();
    expect(evaluateExpr("1 +", { row, nowMs: NOW })).toBeNull();
    expect(evaluateExpr("window.alert(1)", { row, nowMs: NOW })).toBeNull();
    expect(evaluateExpr('nope("score")', { row, nowMs: NOW })).toBeNull();
    expect(evaluateExpr("", { row, nowMs: NOW })).toBeNull();
  });
});

describe("applyTableDerivations", () => {
  const author = TableAuthorPropsSchema.parse({
    columns: [
      { key: "name", label: "Name" },
      {
        key: "current",
        label: "Current",
        expr: '0.35 * tier(days_since("posted"), 1, 1.0, 3, 0.75, 7, 0.55, 0.05) + 0.65 * num("affinity")',
        precision: 2,
      },
    ],
    sort: { key: "current", dir: "desc" },
  });

  it("injects derived values and sorts by them, nulls last", () => {
    const rows = [
      { name: "stale-but-loved", posted: "2026-06-01", affinity: "0.9" },
      { name: "fresh", posted: "2026-07-09", affinity: "0.5" },
      { name: "broken", posted: null, affinity: null },
    ];
    const out = applyTableDerivations(author, rows, NOW);
    expect(out.map((r) => r["name"])).toEqual([
      "fresh", // 0.35*1.0 + 0.65*0.5 = 0.68
      "stale-but-loved", // 0.35*0.05 + 0.65*0.9 = 0.60
      "broken", // unparseable → null → last
    ]);
    expect(out[0]!["current"]).toBe(0.68);
    expect(out[1]!["current"]).toBe(0.6);
    expect(out[2]!["current"]).toBeNull();
  });

  it("leaves rows untouched when no expr/sort is authored", () => {
    const plain = TableAuthorPropsSchema.parse({
      columns: [{ key: "name", label: "Name" }],
    });
    const rows = [{ name: "b" }, { name: "a" }];
    expect(applyTableDerivations(plain, rows, NOW)).toEqual(rows);
  });

  it("sorts string columns lexically and respects asc", () => {
    const byName = TableAuthorPropsSchema.parse({
      columns: [{ key: "name", label: "Name" }],
      sort: { key: "name", dir: "asc" },
    });
    const out = applyTableDerivations(byName, [{ name: "b" }, { name: "a" }], NOW);
    expect(out.map((r) => r["name"])).toEqual(["a", "b"]);
  });
});
