import { describe, it, expect } from "vitest";
import {
  assembleLensSpec,
  buildForest,
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
  it("registers all fifteen components (10 lenses + 5 controls)", () => {
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
      "Tree",
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

describe("query-backed Select assembly", () => {
  it("injects rows and passes the $bindState value marker through", () => {
    const spec = assembleLensSpec(
      "pick",
      "Select",
      { value_column: "from", label_column: "to", value: { $bindState: "/sel" } },
      fakeResult,
    );
    const props = spec.elements["pick"]?.props as {
      rows: unknown[];
      value: unknown;
    };
    expect(props.rows).toEqual(fakeResult.rows);
    expect(props.value).toEqual({ $bindState: "/sel" });
  });

  it("author schema rejects a missing value_column", () => {
    expect(() =>
      assembleLensSpec("pick", "Select", { label: "X" }, fakeResult),
    ).toThrow();
  });
});

describe("Form picker field schema", () => {
  it("picker requires options_query + value_column; non-picker forbids them", () => {
    expect(() =>
      assembleLensSpec(
        "f",
        "Form",
        {
          fields: [
            {
              name: "task",
              kind: "picker",
              options_query: { ref: "all_tasks" },
              value_column: "slug",
            },
          ],
          mutations: [{ ref: "m", params: {} }],
        },
        fakeResult,
      ),
    ).not.toThrow();
    expect(() =>
      assembleLensSpec(
        "f",
        "Form",
        {
          fields: [{ name: "task", kind: "picker" }],
          mutations: [{ ref: "m", params: {} }],
        },
        fakeResult,
      ),
    ).toThrow(/requires options_query/);
    expect(() =>
      assembleLensSpec(
        "f",
        "Form",
        {
          fields: [
            {
              name: "title",
              kind: "text",
              options_query: { ref: "q" },
              mutation: { ref: "m" },
            },
          ],
        },
        fakeResult,
      ),
    ).toThrow(/require kind: picker/);
  });
});

describe("Tree lens", () => {
  it("builds a Tree spec with rows merged in", () => {
    const spec = assembleLensSpec(
      "t1",
      "Tree",
      {
        levels: [
          { key: "d.slug", label: "d.name" },
          { key: "c.slug", label: "c.name" },
        ],
        select_state: "/selected",
      },
      fakeResult,
    );
    expect(spec.elements["t1"]?.type).toBe("Tree");
    expect((spec.elements["t1"]?.props as { rows: unknown[] }).rows).toEqual(
      fakeResult.rows,
    );
  });

  it("rejects fewer than two levels", () => {
    expect(() =>
      assembleLensSpec("t1", "Tree", { levels: [{ key: "d.slug" }] }, fakeResult),
    ).toThrow();
  });
});

describe("buildForest", () => {
  const LEVELS = [
    { key: "d", label: "dn" },
    { key: "c", label: "cn" },
    { key: "r", label: "rn" },
  ];

  it("groups shared prefixes, dedupes, keeps first-seen order and labels", () => {
    const rows = [
      { d: "sys", dn: "Systems", c: "loop", cn: "Feedback loops", r: "attr", rn: "Attractors" },
      { d: "sys", dn: "Systems", c: "loop", cn: "Feedback loops", r: "emer", rn: "Emergence" },
      { d: "sys", dn: "Systems", c: "chunk", cn: "Chunking", r: "attr", rn: "Attractors" },
      { d: "cog", dn: "Cognitive", c: "bias", cn: "Bias", r: "loop", rn: "Feedback loops" },
      // duplicate full path — must not duplicate nodes
      { d: "sys", dn: "Systems", c: "loop", cn: "Feedback loops", r: "attr", rn: "Attractors" },
    ];
    const forest = buildForest(rows, LEVELS);
    expect(forest.map((n) => n.label)).toEqual(["Systems", "Cognitive"]);
    const sys = forest[0]!;
    expect(sys.children.map((n) => n.label)).toEqual(["Feedback loops", "Chunking"]);
    expect(sys.children[0]!.children.map((n) => n.label)).toEqual([
      "Attractors",
      "Emergence",
    ]);
    // same key under different parents = distinct nodes with distinct paths
    const cogLoop = forest[1]!.children[0]!.children[0]!;
    expect(cogLoop.key).toBe("loop");
    expect(cogLoop.path).not.toBe(sys.children[0]!.path);
    expect(cogLoop.depth).toBe(2);
  });

  it("truncates sparse paths at the first empty level and falls back to key as label", () => {
    const rows = [
      { d: "sys", dn: "Systems", c: "solo", cn: null, r: null, rn: null },
      { d: "sys", dn: "Systems", c: "", cn: "ignored" },
      { d: "lonely" }, // level-1-only row, no label column value
    ];
    const forest = buildForest(rows, LEVELS);
    expect(forest.map((n) => n.label)).toEqual(["Systems", "lonely"]);
    const solo = forest[0]!.children[0]!;
    expect(solo.label).toBe("solo"); // null label → key fallback
    expect(solo.children).toEqual([]);
  });

  it("returns an empty forest for no rows", () => {
    expect(buildForest([], LEVELS)).toEqual([]);
  });
});
