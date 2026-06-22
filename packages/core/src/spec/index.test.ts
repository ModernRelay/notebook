import { describe, it, expect } from "vitest";
import { parseNotebook } from "./index.js";

describe("parseNotebook", () => {
  it("parses a server-mode notebook", () => {
    const yaml = `
version: 1
title: Demo
server: http://127.0.0.1:8080
graph: company
cells:
  - id: t
    lens: Table
    query:
      fixture: { kind: nodes, where: { type: Decision }, project: [id, title] }
    props: { columns: [{ key: id, label: ID }] }
`;
    const nb = parseNotebook(yaml);
    expect(nb.server).toBe("http://127.0.0.1:8080");
    expect(nb.graph).toBe("company");
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0]?.query.fixture?.kind).toBe("nodes");
  });

  it("keeps deprecated raw .gq server-mode query.source accepted", () => {
    const yaml = `
version: 1
title: Server
cells:
  - id: t
    lens: Table
    query:
      source: "match (n: Decision) return n.id"
      branch: main
    props: { columns: [{ key: id, label: ID }] }
`;
    const nb = parseNotebook(yaml);
    expect(nb.cells[0]?.query.source).toContain("Decision");
  });

  it("rejects unknown lens", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - { id: t, lens: WhirlyGig, query: { source: "x" } }
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
    query: { source: "x", branch: main, snapshot: v1 }
`),
    ).toThrow();
  });

  it("rejects when both query.source and query.fixture are set", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
cells:
  - id: t
    lens: Table
    query:
      source: "x"
      fixture: { kind: nodes }
`),
    ).toThrow();
  });

  it("rejects when neither query.source nor query.fixture is set", () => {
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

  it("accepts each fixture-query kind", () => {
    const nodes = `
version: 1
title: x
fixture: ./f.json
cells:
  - { id: t, lens: Table, query: { fixture: { kind: nodes, where: { type: D } } } }
`;
    const path = `
version: 1
title: x
fixture: ./f.json
cells:
  - id: p
    lens: Path
    query:
      fixture:
        kind: path
        steps:
          - { var: a, type: A }
          - { edge: e, var: b, type: B }
        project:
          - { var: a.id, as: from }
          - { literal: e, as: pred }
          - { var: b.id, as: to }
`;
    const ego = `
version: 1
title: x
fixture: ./f.json
cells:
  - id: e
    lens: Subgraph
    query:
      fixture:
        kind: ego
        center: { type: D, where: { id: x } }
        out: [foo]
        project:
          - { var: center.id, as: id }
          - { var: edge_type, as: predicate }
          - { var: neighbor.id, as: neighbor }
`;
    expect(parseNotebook(nodes).cells[0]?.query.fixture?.kind).toBe("nodes");
    expect(parseNotebook(path).cells[0]?.query.fixture?.kind).toBe("path");
    expect(parseNotebook(ego).cells[0]?.query.fixture?.kind).toBe("ego");
  });

  it("accepts a control cell (no query) with on + visible", () => {
    const yaml = `
version: 1
title: Controls
fixture: ./f.json
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

  it("rejects a Table cell without a query", () => {
    expect(() =>
      parseNotebook(`
version: 1
title: x
fixture: ./f.json
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
fixture: ./f.json
cells:
  - id: b
    lens: Button
    props: { label: Hi }
    query: { fixture: { kind: nodes } }
`),
    ).toThrow();
  });

  it("defaults props to empty object", () => {
    const yaml = `
version: 1
title: x
fixture: ./f.json
cells:
  - id: t
    lens: Table
    query: { fixture: { kind: nodes } }
`;
    expect(parseNotebook(yaml).cells[0]?.props).toEqual({});
  });
});
