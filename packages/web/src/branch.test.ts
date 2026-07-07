import { describe, it, expect } from "vitest";
import {
  computeTableDeltas,
  defaultBranchName,
  rowDeltaLabel,
  tableDisplayName,
} from "./branch.js";
import type { SnapshotOutput } from "@modernrelay/notebook-client";

const snap = (
  branch: string,
  tables: Array<[string, number, number, (string | null)?]>, // [key, version, rows, writer]
): SnapshotOutput => ({
  branch,
  manifest_version: 1,
  tables: tables.map(([table_key, version, row_count, writer]) => ({
    table_key,
    version,
    row_count,
    writer: writer ?? null,
  })),
});

describe("computeTableDeltas", () => {
  it("elides untouched tables, reports adds/edits/new tables, name-sorted", () => {
    const base = snap("main", [
      ["node:Task", 14, 10],
      ["node:Comment", 8, 3],
      ["node:Reviewer", 2, 5],
    ]);
    const branch = snap("stage", [
      ["node:Task", 16, 12], // +2 rows
      ["node:Comment", 9, 3], // edit, no net adds
      ["node:Reviewer", 2, 5], // untouched → elided
      ["edge:AssignedTo", 4, 7], // new on branch
    ]);
    expect(computeTableDeltas(base, branch)).toEqual([
      { table: "edge:AssignedTo", rowDelta: 7, fromVersion: undefined, toVersion: 4, diverged: false },
      { table: "node:Comment", rowDelta: 0, fromVersion: 8, toVersion: 9, diverged: false },
      { table: "node:Task", rowDelta: 2, fromVersion: 14, toVersion: 16, diverged: false },
    ]);
  });

  it("identical snapshots produce no deltas (nothing staged)", () => {
    const a = snap("main", [["node:Task", 14, 10]]);
    const b = snap("stage", [["node:Task", 14, 10]]);
    expect(computeTableDeltas(a, b)).toEqual([]);
  });

  it("flags DIVERGED lineages: same version+rows but a different writer", () => {
    // Versions are per-lineage counters — two branches that each made one
    // edit to the same table collide numerically while contents differ.
    const main = snap("main", [["node:Task", 12, 10, null]]);
    const other = snap("conflict-b", [["node:Task", 12, 10, "conflict-b"]]);
    expect(computeTableDeltas(main, other)).toEqual([
      { table: "node:Task", rowDelta: 0, fromVersion: 12, toVersion: 12, diverged: true },
    ]);
  });
});

describe("labels", () => {
  it("tableDisplayName strips the kind prefix", () => {
    expect(tableDisplayName("node:Task")).toBe("Task");
    expect(tableDisplayName("edge:AssignedTo")).toBe("AssignedTo");
    expect(tableDisplayName("Task")).toBe("Task");
  });
  it("rowDeltaLabel pluralizes and signs", () => {
    expect(rowDeltaLabel(3)).toBe("+3 rows");
    expect(rowDeltaLabel(-1)).toBe("−1 row");
    expect(rowDeltaLabel(0)).toBe("±0");
  });
});

describe("defaultBranchName", () => {
  it("is work-<local date>", () => {
    const d = new Date();
    const expected = `work-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(defaultBranchName()).toBe(expected);
  });
});
