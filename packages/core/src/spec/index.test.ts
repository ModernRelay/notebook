import { describe, it, expect } from "vitest";
import { parseNotebook, MutationSpecSchema } from "./index.js";

describe("parseNotebook", () => {
  it("parses a server-mode notebook with a catalog query ref", () => {
    const yaml = `
version: 1
title: Demo
server: http://127.0.0.1:8080
graph: company
cells:
  - id: t
    lens: Table
    query:
      ref: decisions_by_urgency
      params: { status: { $state: "/filters/status" } }
    props: { columns: [{ key: id, label: ID }] }
`;
    const nb = parseNotebook(yaml);
    expect(nb.server).toBe("http://127.0.0.1:8080");
    expect(nb.graph).toBe("company");
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0]?.query?.ref).toBe("decisions_by_urgency");
  });

  it("accepts the raw .gq escape hatch (query.rawGq)", () => {
    const yaml = `
version: 1
title: Server
cells:
  - id: t
    lens: Table
    query:
      rawGq: "query q() { match { $d: Decision } return { $d.slug as id } }"
      branch: main
    props: { columns: [{ key: id, label: ID }] }
`;
    const nb = parseNotebook(yaml);
    expect(nb.cells[0]?.query?.rawGq).toContain("Decision");
  });

  it("rejects unknown lens", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - { id: t, lens: WhirlyGig, query: { ref: q } }
`),
    ).toThrow();
  });

  it("rejects branch + snapshot together", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Table
    query: { ref: q, branch: main, snapshot: v1 }
`),
    ).toThrow();
  });

  it("rejects when both query.ref and query.rawGq are set", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Table
    query: { ref: q, rawGq: "x" }
`),
    ).toThrow();
  });

  it("rejects when neither query.ref nor query.rawGq is set", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Table
    query: { branch: main }
`),
    ).toThrow();
  });

  it("rejects a stale top-level fixture: key (strict schema)", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
fixture: ./f.json
cells:
  - { id: t, lens: Table, query: { ref: q } }
`),
    ).toThrow();
  });

  it("rejects an unknown query key (strict schema)", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - { id: t, lens: Table, query: { ref: q, bogus: 1 } }
`),
    ).toThrow();
  });

  it("accepts a control cell (no query) with on + visible", () => {
    const yaml = `
version: 1
title: Controls
cells:
  - id: filter
    lens: Select
    props:
      options: [all, proposed, accepted]
      value: { $bindState: "/filters/decision_status" }
  - id: approve
    lens: Button
    props: { label: Approve, variant: primary }
    on:
      press:
        action: approve
        params: { id: { $state: "/selection/decision_id" } }
    visible: { $state: "/selection/decision_id" }
`;
    const nb = parseNotebook(yaml);
    expect(nb.cells).toHaveLength(2);
    expect(nb.cells[0]?.lens).toBe("Select");
    expect(nb.cells[0]?.query).toBeUndefined();
    expect(nb.cells[1]?.lens).toBe("Button");
    expect(nb.cells[1]?.on?.["press"]?.action).toBe("approve");
  });

  it("rejects a removed overlay field (display, strict schema)", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Card
    query: { ref: q }
    display: drawer
`),
    ).toThrow();
  });

  it("parses a cell's layout-grid width", () => {
    const nb = parseNotebook(`
version: 1
title: Grid
cells:
  - id: a
    lens: Table
    query: { ref: q }
    width: half
    props: { columns: [{ key: x, label: X }] }
`);
    expect(nb.cells[0]?.width).toBe("half");
  });

  it("rejects an unknown width (enum)", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Table
    query: { ref: q }
    width: quarter
`),
    ).toThrow();
  });

  it("parses a cell's tab", () => {
    const nb = parseNotebook(`
version: 1
title: Tabbed
cells:
  - id: a
    lens: Table
    tab: Overview
    query: { ref: q }
    props: { columns: [{ key: x, label: X }] }
`);
    expect(nb.cells[0]?.tab).toBe("Overview");
  });

  it("rejects an empty tab string", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Table
    tab: ""
    query: { ref: q }
    props: { columns: [{ key: x, label: X }] }
`),
    ).toThrow();
  });

  it("parses a cell's color and Table column badge/align flags", () => {
    const nb = parseNotebook(`
version: 1
title: Tinted
cells:
  - id: a
    lens: Table
    color: amber
    query: { ref: q }
    props:
      columns:
        - { key: name, label: Name }
        - { key: conf, label: Conf, badge: true }
        - { key: n, label: N, align: right }
`);
    expect(nb.cells[0]?.color).toBe("amber");
    const cols = (nb.cells[0]?.props as { columns: Record<string, unknown>[] })
      .columns;
    expect(cols[1]?.badge).toBe(true);
    expect(cols[2]?.align).toBe("right");
  });

  it("rejects an unknown card color (enum)", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Table
    color: chartreuse
    query: { ref: q }
    props: { columns: [{ key: x, label: X }] }
`),
    ).toThrow();
  });

  it("parses a cell's height and rejects an unknown one", () => {
    const nb = parseNotebook(`
version: 1
title: Sized
cells:
  - id: a
    lens: Table
    height: tall
    query: { ref: q }
    props: { columns: [{ key: x, label: X }] }
`);
    expect(nb.cells[0]?.height).toBe("tall");
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Table
    height: huge
    query: { ref: q }
    props: { columns: [{ key: x, label: X }] }
`),
    ).toThrow();
  });

  it("rejects a Table cell without a query", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - { id: t, lens: Table, props: { columns: [{ key: x, label: X }] } }
`),
    ).toThrow();
  });

  it("rejects a Button cell with a query", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: b
    lens: Button
    props: { label: Hi }
    query: { ref: q }
`),
    ).toThrow();
  });

  it("defaults props to empty object", () => {
    const yaml = `
version: 1
title: x
cells:
  - id: t
    lens: Table
    query: { ref: q }
`;
    expect(parseNotebook(yaml).cells[0]?.props).toEqual({});
  });
});

describe("MutationSpecSchema", () => {
  it("accepts a catalog ref mutation with params + optimistic", () => {
    const r = MutationSpecSchema.safeParse({
      ref: "approve_clause",
      params: { clause: { $row: "id" } },
      optimistic: { set: { status: "approved" } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a rawGq mutation", () => {
    const r = MutationSpecSchema.safeParse({
      rawGq: "query q($id: String){ update Issue set { status: \"closed\" } where slug = $id }",
      params: { id: { $row: "id" } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a mutation with both ref and rawGq (exactly-one, mirrors query)", () => {
    expect(MutationSpecSchema.safeParse({ ref: "r", rawGq: "x" }).success).toBe(
      false,
    );
  });

  it("rejects a mutation with neither ref nor rawGq", () => {
    expect(MutationSpecSchema.safeParse({ params: { x: 1 } }).success).toBe(
      false,
    );
  });

  it("rejects a stale set_field mutation (no kind discriminator anymore)", () => {
    expect(
      MutationSpecSchema.safeParse({
        kind: "set_field",
        target_type: "PolicyClause",
        field: "status",
        value: "approved",
      }).success,
    ).toBe(false);
  });
});
