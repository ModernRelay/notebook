import { describe, it, expect } from "vitest";
import {
  assembleLensSpec,
  lensComponents,
  type QueryResult,
} from "./index.js";

const fakeResult: QueryResult = {
  query_name: "q",
  target: "fixture",
  row_count: 2,
  columns: ["from", "p1", "to"],
  rows: [
    { from: "Andrew", p1: "owns", to: "Canon" },
    { from: "Bob", p1: "owns", to: "Plan" },
  ],
};

describe("lensComponents", () => {
  it("registers all nine components (6 lenses + 3 controls)", () => {
    expect(Object.keys(lensComponents).sort()).toEqual([
      "ActionList",
      "Button",
      "Card",
      "Path",
      "Select",
      "Subgraph",
      "Table",
      "Timeline",
      "Toggle",
    ]);
  });

  it("each definition has Zod props and a non-empty description", () => {
    for (const [name, def] of Object.entries(lensComponents)) {
      expect(def.props, `${name} props`).toBeDefined();
      expect(def.description.length).toBeGreaterThan(10);
    }
  });
});

describe("assembleLensSpec", () => {
  it("builds a Table spec with rows merged in", () => {
    const spec = assembleLensSpec(
      "c1",
      "Table",
      { columns: [{ key: "from", label: "From" }] },
      fakeResult,
    );
    expect(spec.root).toBe("c1");
    expect(spec.elements["c1"]?.type).toBe("Table");
    expect((spec.elements["c1"]?.props as { rows: unknown[] }).rows).toEqual(
      fakeResult.rows,
    );
  });

  it("rejects malformed author props", () => {
    expect(() =>
      assembleLensSpec("bad", "Table", { columns: [] }, fakeResult),
    ).toThrow();
    expect(() =>
      assembleLensSpec("bad", "Path", { steps: [] }, fakeResult),
    ).toThrow();
  });
});
