import { describe, it, expect } from "vitest";
import { FixtureSource } from "./source.js";
import type { Fixture } from "./validator.js";

const FIXTURE: Fixture = {
  version: 1,
  title: "tiny",
  nodes: [
    { type: "PolicyClause", id: "c1", title: "Clause", status: "draft" },
  ],
  edges: [],
};

describe("FixtureSource", () => {
  it("declares runtime capabilities", () => {
    const source = new FixtureSource(FIXTURE);
    expect(source.capabilities()).toMatchObject({
      structuredQueryKinds: ["nodes", "path", "ego"],
      rawGq: false,
      mutationKinds: ["set_field"],
      branchReads: false,
      snapshotReads: false,
      branchWrites: false,
    });
  });

  it("implements the runtime read and mutation contract", async () => {
    const source = new FixtureSource(FIXTURE);
    const before = await source.read(
      {
        cellId: "clauses",
        fixtureQuery: {
          kind: "nodes",
          where: { type: "PolicyClause" },
          project: ["id", "status"],
        },
      },
      { cellId: "clauses", readTarget: {}, state: {} },
    );
    expect(before.rows[0]?.status).toBe("draft");
    await source.mutate(
      {
        params: {
          kind: "set_field",
          target_type: "PolicyClause",
          target_id: "c1",
          field: "status",
          value: "approved",
        },
      },
      { readTarget: {}, writeTarget: {}, state: {} },
    );
    const after = await source.read(
      {
        cellId: "clauses",
        fixtureQuery: {
          kind: "nodes",
          where: { type: "PolicyClause" },
          project: ["id", "status"],
        },
      },
      { cellId: "clauses", readTarget: {}, state: {} },
    );
    expect(after.rows[0]?.status).toBe("approved");
  });
});
