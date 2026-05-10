import { describe, it, expect } from "vitest";
import {
  edgeToPredicate,
  translateFixtureQuery,
  translateMutation,
  translateNodesQuery,
  translatePathQuery,
  UnsupportedTranslationError,
} from "./translate.js";

describe("edgeToPredicate", () => {
  it("PascalCase → camelCase", () => {
    expect(edgeToPredicate("HasClause")).toBe("hasClause");
    expect(edgeToPredicate("Owns")).toBe("owns");
    expect(edgeToPredicate("OwnsPolicy")).toBe("ownsPolicy");
  });
  it("snake_case → camelCase", () => {
    expect(edgeToPredicate("has_clause")).toBe("hasClause");
    expect(edgeToPredicate("governed_by")).toBe("governedBy");
  });
  it("already camel", () => {
    expect(edgeToPredicate("hasClause")).toBe("hasClause");
  });
});

describe("translateNodesQuery", () => {
  it("basic match + return", () => {
    const r = translateNodesQuery({
      kind: "nodes",
      where: { type: "Decision" },
      project: ["id", "title"],
    });
    expect(r.query_source).toContain("$n: Decision");
    expect(r.query_source).toContain("$n.id as id, $n.title as title");
    expect(r.params).toEqual({});
  });

  it("filters become typed parameters", () => {
    const r = translateNodesQuery({
      kind: "nodes",
      where: { type: "Decision", status: "proposed" },
      project: ["id"],
    });
    expect(r.query_source).toContain("$n.status = $w_status");
    expect(r.query_source).toMatch(/\$w_status: String/);
    expect(r.params).toEqual({ w_status: "proposed" });
  });

  it("emits order_by + limit", () => {
    const r = translateNodesQuery({
      kind: "nodes",
      where: { type: "Decision" },
      project: ["id"],
      order_by: { field: "urgency", direction: "asc" },
      limit: 5,
    });
    expect(r.query_source).toContain("order { $n.urgency asc }");
    expect(r.query_source).toContain("limit 5");
  });

  it("requires where.type", () => {
    expect(() =>
      translateNodesQuery({ kind: "nodes", project: ["id"] }),
    ).toThrow(UnsupportedTranslationError);
  });

  it("rejects suspicious field names", () => {
    expect(() =>
      translateNodesQuery({
        kind: "nodes",
        where: { type: "Decision", "bad name": "x" },
        project: ["id"],
      }),
    ).toThrow();
  });
});

describe("translatePathQuery", () => {
  it("forward two-step traversal", () => {
    const r = translatePathQuery({
      kind: "path",
      steps: [
        { var: "p", type: "Policy" },
        { edge: "HasClause", var: "c", type: "PolicyClause" },
      ],
      project: [
        { var: "c.id", as: "id" },
        { var: "c.title", as: "title" },
      ],
    });
    expect(r.query_source).toContain("$p: Policy");
    expect(r.query_source).toContain("$c: PolicyClause");
    expect(r.query_source).toContain("$p hasClause $c");
    expect(r.query_source).toContain("$c.id as id, $c.title as title");
  });

  it("reverse traversal flips source/target", () => {
    const r = translatePathQuery({
      kind: "path",
      steps: [
        { var: "d", type: "Decision" },
        { edge: "Owns", var: "a", type: "Actor", direction: "in" },
      ],
      project: [
        { var: "d.title", as: "decision" },
        { var: "a.name", as: "actor" },
      ],
    });
    // `Owns` is Actor->Decision; reverse means anchor on decision and walk back to actor.
    expect(r.query_source).toContain("$a owns $d");
  });

  it("literal projections become parameters", () => {
    const r = translatePathQuery({
      kind: "path",
      steps: [
        { var: "s", type: "Signal" },
        { edge: "Triggers", var: "d", type: "Decision" },
      ],
      project: [
        { var: "s.title", as: "signal_title" },
        { literal: "triggered", as: "p" },
        { var: "d.title", as: "decision_title" },
      ],
    });
    expect(r.query_source).toMatch(/\$lit_p as p/);
    expect(r.params["lit_p"]).toBe("triggered");
  });
});

describe("translateMutation", () => {
  it("set_field becomes a parameterized update", () => {
    const r = translateMutation({
      kind: "set_field",
      target_type: "PolicyClause",
      field: "status",
      value: "approved",
      target_id: "pdr-c1",
    });
    expect(r.query_source).toContain(
      "update PolicyClause set { status: $value } where slug = $target_id",
    );
    expect(r.query_source).toContain("$value: String");
    expect(r.query_source).toContain("$target_id: String");
    expect(r.params).toEqual({ value: "approved", target_id: "pdr-c1" });
  });
});

describe("translateFixtureQuery dispatch", () => {
  it("dispatches nodes / path", () => {
    expect(
      translateFixtureQuery({
        kind: "nodes",
        where: { type: "Decision" },
        project: ["id"],
      }).query_source,
    ).toContain("Decision");
    expect(
      translateFixtureQuery({
        kind: "path",
        steps: [
          { var: "a", type: "A" },
          { edge: "EdgeName", var: "b", type: "B" },
        ],
        project: [{ var: "a.id", as: "id" }],
      }).query_source,
    ).toContain("edgeName");
  });

  it("rejects ego with a clear v0.8 message", () => {
    expect(() =>
      translateFixtureQuery({
        kind: "ego",
        center: { type: "Policy", where: {} },
        out: ["HasClause"],
        in: [],
        project: [{ var: "neighbor.id", as: "id" }],
      }),
    ).toThrow(/ego.*not supported.*v0\.7/i);
  });
});
