import { describe, it, expect } from "vitest";
import type { Fixture } from "./validator.js";
import { runFixtureQuery } from "./runner.js";

const FIX: Fixture = {
  version: 1,
  title: "tiny",
  nodes: [
    { type: "Actor", id: "a1", name: "Andrew" },
    { type: "Actor", id: "a2", name: "Bruno" },
    { type: "Decision", id: "d1", title: "Adopt SOC2", urgency: "high" },
    { type: "Decision", id: "d2", title: "Fix bug",   urgency: "low"  },
    { type: "Signal",   id: "s1", title: "Compliance need" },
  ],
  edges: [
    { type: "owns",     from: "a1", to: "d1" },
    { type: "owns",     from: "a2", to: "d2" },
    { type: "triggers", from: "s1", to: "d1" },
  ],
};

describe("runFixtureQuery / nodes", () => {
  it("filters by where", () => {
    const r = runFixtureQuery({ kind: "nodes", where: { type: "Decision" } }, FIX);
    expect(r.rows).toHaveLength(2);
  });

  it("projects requested columns only", () => {
    const r = runFixtureQuery(
      { kind: "nodes", where: { type: "Decision" }, project: ["id", "title"] },
      FIX,
    );
    expect(r.columns).toEqual(["id", "title"]);
    expect(r.rows[0]).toEqual({ id: "d1", title: "Adopt SOC2" });
  });

  it("orders ascending and descending", () => {
    const asc = runFixtureQuery(
      {
        kind: "nodes",
        where: { type: "Decision" },
        project: ["urgency"],
        order_by: { field: "urgency", direction: "asc" },
      },
      FIX,
    );
    expect(asc.rows.map((r) => r.urgency)).toEqual(["high", "low"]);
    const desc = runFixtureQuery(
      {
        kind: "nodes",
        where: { type: "Decision" },
        project: ["urgency"],
        order_by: { field: "urgency", direction: "desc" },
      },
      FIX,
    );
    expect(desc.rows.map((r) => r.urgency)).toEqual(["low", "high"]);
  });

  it("respects limit", () => {
    const r = runFixtureQuery(
      { kind: "nodes", where: { type: "Decision" }, limit: 1 },
      FIX,
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe("runFixtureQuery / path", () => {
  it("traverses a single edge", () => {
    const r = runFixtureQuery(
      {
        kind: "path",
        steps: [
          { var: "a", type: "Actor" },
          { edge: "owns", var: "d", type: "Decision" },
        ],
        project: [
          { var: "a.name", as: "actor" },
          { literal: "owns", as: "p" },
          { var: "d.title", as: "decision" },
        ],
      },
      FIX,
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ actor: "Andrew", p: "owns", decision: "Adopt SOC2" });
  });

  it("traverses with direction: in (reverse)", () => {
    // Decision <-owns- Actor: anchor on Decision and walk against the edge.
    const r = runFixtureQuery(
      {
        kind: "path",
        steps: [
          { var: "d", type: "Decision" },
          { edge: "owns", var: "a", type: "Actor", direction: "in" },
        ],
        project: [
          { var: "d.title", as: "decision" },
          { literal: "owned by", as: "p" },
          { var: "a.name", as: "actor" },
        ],
      },
      FIX,
    );
    expect(r.rows).toHaveLength(2);
    const decisions = r.rows.map((row) => row.decision).sort();
    expect(decisions).toEqual(["Adopt SOC2", "Fix bug"]);
  });

  it("type-filters at every step", () => {
    const r = runFixtureQuery(
      {
        kind: "path",
        steps: [
          { var: "a", type: "Actor" },
          { edge: "owns", var: "x", type: "Issue" }, // no Issue type
        ],
        project: [
          { var: "a.name", as: "actor" },
          { var: "x.id", as: "issue" },
        ],
      },
      FIX,
    );
    expect(r.rows).toHaveLength(0);
  });
});

describe("runFixtureQuery / ego", () => {
  it("returns one row per incident edge", () => {
    const r = runFixtureQuery(
      {
        kind: "ego",
        center: { type: "Decision", where: { id: "d1" } },
        out: [],
        in: ["owns", "triggers"],
        project: [
          { var: "center.id", as: "id" },
          { var: "edge_type", as: "predicate" },
          { var: "neighbor.id", as: "neighbor" },
        ],
      },
      FIX,
    );
    expect(r.rows).toHaveLength(2);
    const predicates = r.rows.map((row) => row.predicate).sort();
    expect(predicates).toEqual(["owns", "triggers"]);
  });

  it("emits a single bare-center row when no neighbors match", () => {
    const r = runFixtureQuery(
      {
        kind: "ego",
        center: { type: "Decision", where: { id: "d2" } },
        out: ["nonexistent"],
        in: [],
        project: [
          { var: "center.id", as: "id" },
          { var: "edge_type", as: "predicate" },
          { var: "neighbor.id", as: "neighbor" },
        ],
      },
      FIX,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.predicate).toBeNull();
  });
});
