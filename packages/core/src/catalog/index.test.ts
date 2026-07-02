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
  it("registers all fourteen components (9 lenses + 5 controls)", () => {
    expect(Object.keys(lensComponents).sort()).toEqual([
      "ActionList",
      "Button",
      "Card",
      "Form",
      "NumberInput",
      "Path",
      "Quote",
      "Select",
      "Subgraph",
      "Table",
      "Text",
      "TextInput",
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

  it("builds a Quote spec with rows merged in", () => {
    const spec = assembleLensSpec(
      "q1",
      "Quote",
      { text_column: "from", source_column: "to", meta_columns: ["p1"] },
      fakeResult,
    );
    expect(spec.elements["q1"]?.type).toBe("Quote");
    expect((spec.elements["q1"]?.props as { rows: unknown[] }).rows).toEqual(
      fakeResult.rows,
    );
  });

  it("builds a Text spec with rows merged in", () => {
    const spec = assembleLensSpec(
      "t1",
      "Text",
      { title_column: "from", text_column: "p1" },
      fakeResult,
    );
    expect(spec.elements["t1"]?.type).toBe("Text");
    expect((spec.elements["t1"]?.props as { rows: unknown[] }).rows).toEqual(
      fakeResult.rows,
    );
  });

  it("accepts the copy flag on a Table column and a Card field", () => {
    expect(() =>
      assembleLensSpec(
        "c",
        "Table",
        { columns: [{ key: "from", label: "From", copy: true }] },
        fakeResult,
      ),
    ).not.toThrow();
    expect(() =>
      assembleLensSpec(
        "c",
        "Card",
        { fields: [{ key: "from", label: "From", copy: true }] },
        fakeResult,
      ),
    ).not.toThrow();
  });

  it("accepts badge/align on a Table column and badge on a Card field", () => {
    expect(() =>
      assembleLensSpec(
        "c",
        "Table",
        {
          columns: [
            { key: "conf", label: "Conf", badge: true },
            { key: "n", label: "N", align: "right" },
          ],
        },
        fakeResult,
      ),
    ).not.toThrow();
    expect(() =>
      assembleLensSpec(
        "c",
        "Card",
        { fields: [{ key: "conf", label: "Conf", badge: true }] },
        fakeResult,
      ),
    ).not.toThrow();
  });

  it("rejects malformed author props", () => {
    expect(() =>
      assembleLensSpec("bad", "Table", { columns: [] }, fakeResult),
    ).toThrow();
    expect(() =>
      assembleLensSpec("bad", "Path", { steps: [] }, fakeResult),
    ).toThrow();
    // Quote: meta_columns entries must be non-empty.
    expect(() =>
      assembleLensSpec("bad", "Quote", { meta_columns: [""] }, fakeResult),
    ).toThrow();
  });
});

describe("Form lens", () => {
  const FIELD = {
    name: "title",
    kind: "text",
    mutation: { ref: "set_title", params: { t: { $input: "title" } } },
  };

  it("assembles a Form spec with rows merged in", () => {
    const spec = assembleLensSpec(
      "f1",
      "Form",
      { fields: [FIELD], key_column: "slug" },
      fakeResult,
    );
    expect(spec.elements["f1"]?.type).toBe("Form");
    expect((spec.elements["f1"]?.props as { rows: unknown[] }).rows).toEqual(
      fakeResult.rows,
    );
  });

  it("rejects a select field without options", () => {
    expect(() =>
      assembleLensSpec(
        "f",
        "Form",
        {
          fields: [
            { name: "p", kind: "select", mutation: { ref: "set_p" } },
          ],
        },
        fakeResult,
      ),
    ).toThrow(/requires non-empty options/);
  });

  it("rejects duplicate field names", () => {
    expect(() =>
      assembleLensSpec(
        "f",
        "Form",
        { fields: [FIELD, FIELD] },
        fakeResult,
      ),
    ).toThrow(/duplicate form field name/);
  });
});

describe("Form lens — form-level mutations (create-form)", () => {
  it("accepts fields without per-field mutations when form-level mutations exist", () => {
    expect(() =>
      assembleLensSpec(
        "f",
        "Form",
        {
          fields: [
            { name: "slug", kind: "text" },
            { name: "text", kind: "textarea" },
          ],
          mutations: [
            { ref: "add_comment", params: { slug: { $input: "slug" }, text: { $input: "text" } } },
          ],
        },
        fakeResult,
      ),
    ).not.toThrow();
  });

  it("rejects a form with no mutation anywhere", () => {
    expect(() =>
      assembleLensSpec(
        "f",
        "Form",
        { fields: [{ name: "slug", kind: "text" }] },
        fakeResult,
      ),
    ).toThrow(/form declares no mutation/);
  });
});
