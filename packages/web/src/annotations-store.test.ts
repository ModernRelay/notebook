import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Notebook } from "@modernrelay/notebook-core";

// The web vitest env is node (no window); stub a minimal in-memory localStorage,
// matching the vi.stubGlobal pattern used by App.test.ts.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}
beforeEach(() => vi.stubGlobal("window", { localStorage: memoryStorage() }));
afterEach(() => vi.unstubAllGlobals());
import {
  annotationId,
  annotationsKey,
  clearAnnotations,
  loadAnnotations,
  saveAnnotations,
  serializeAnnotations,
  type AnnotationSession,
} from "./annotations-store.js";

const NB: Notebook = {
  version: 1,
  title: "Company context",
  cells: [
    { id: "decisions", lens: "Table", query: { ref: "decisions_by_urgency" }, props: {} },
    { id: "clauses", lens: "ActionList", query: { ref: "policy_clauses" }, props: {} },
  ],
};

const SESSION: AnnotationSession = {
  instruction: "Reconcile the flagged clauses.",
  items: [
    {
      id: annotationId("decisions", "adopt-soc2"),
      cellId: "decisions",
      lens: "Table",
      queryRef: "decisions_by_urgency",
      key: "adopt-soc2",
      headline: "Adopt SOC2 Type II controls",
      data: { slug: "adopt-soc2", status: "accepted", urgency: "high" },
      note: "revisit the timeline",
      intent: "question",
    },
    {
      id: annotationId("clauses", "pdr-c3"),
      cellId: "clauses",
      lens: "ActionList",
      queryRef: "policy_clauses",
      key: "pdr-c3",
      headline: "EU territoriality",
      data: { id: "pdr-c3", title: "EU territoriality" },
      note: "conflicts with zero-retention",
    },
  ],
};

describe("serializeAnnotations", () => {
  const md = serializeAnnotations(NB, "server: x · graph: company", SESSION);

  it("includes a title, label, and the overall instruction", () => {
    expect(md).toContain("# Notebook annotations — Company context");
    expect(md).toContain("server: x · graph: company");
    expect(md).toContain("Reconcile the flagged clauses.");
  });

  it("groups by cell with the source query and renders each item", () => {
    expect(md).toContain("## decisions (Table · query: decisions_by_urgency)");
    expect(md).toContain("## clauses (ActionList · query: policy_clauses)");
    expect(md).toContain("[question] `adopt-soc2` — Adopt SOC2 Type II controls");
    expect(md).toContain("status: accepted · urgency: high");
    expect(md).toContain("note: revisit the timeline");
    // no intent tag when absent
    expect(md).toContain("`pdr-c3` — EU territoriality");
    expect(md).not.toContain("[fix]");
  });
});

describe("annotation persistence", () => {
  const key = annotationsKey(NB);

  it("annotationsKey is stable for the same notebook", () => {
    expect(annotationsKey(NB)).toBe(key);
    expect(key).toMatch(/^dashbook:annotations:v1:/);
  });

  it("save → load round-trips; clear empties", () => {
    saveAnnotations(key, SESSION);
    const loaded = loadAnnotations(key);
    expect(loaded.items).toHaveLength(2);
    expect(loaded.instruction).toBe("Reconcile the flagged clauses.");
    clearAnnotations(key);
    expect(loadAnnotations(key).items).toHaveLength(0);
  });

  it("returns an empty session for absent / unparseable storage", () => {
    expect(loadAnnotations("nope").items).toEqual([]);
    window.localStorage.setItem(key, "{not json");
    expect(loadAnnotations(key)).toEqual({ items: [], instruction: "" });
  });
});
