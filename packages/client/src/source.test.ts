import { describe, it, expect, vi } from "vitest";
import type { Client, ReadInput, ChangeInput } from "./http.js";
import { ServerSource } from "./source.js";
import type { ExecutionContext, MutationContext } from "@omnigraph/runtime";

const CTX: ExecutionContext = {
  cellId: "cell",
  readTarget: {},
  state: {},
};

describe("ServerSource", () => {
  it("declares runtime capabilities", () => {
    const source = new ServerSource(fakeClient({}));
    expect(source.capabilities()).toMatchObject({
      structuredQueryKinds: ["nodes", "path", "ego"],
      rawGq: true,
      mutationKinds: ["set_field"],
      branchReads: true,
      snapshotReads: true,
      branchWrites: true,
    });
  });

  it("passes raw .gq through as the deprecated escape hatch", async () => {
    const read = vi.fn(async () => readOutput([]));
    const source = new ServerSource(fakeClient({ read }));
    await source.read(
      {
        cellId: "raw",
        querySource: "query q() { match { $d: Decision } return { $d.slug as slug } }",
        queryName: "q",
      },
      CTX,
    );
    expect(read.mock.calls[0]?.[0]).toMatchObject({
      query_source: expect.stringContaining("query q"),
      query_name: "q",
    });
  });

  it("decomposes ego reads and synthesizes bare-center rows", async () => {
    const read = vi.fn(async (input: ReadInput) => {
      if (input.query_name === "decision_neighbors_center") {
        return readOutput([{ id: "d1", name: "D1", __ng_center_id: "d1" }]);
      }
      return readOutput([]);
    });
    const source = new ServerSource(fakeClient({ read }));
    const out = await source.read(
      {
        cellId: "decision-neighbors",
        fixtureQuery: {
          kind: "ego",
          center: { type: "Decision", where: { slug: "d1" } },
          out: ["GovernedBy"],
          in: [],
          project: [
            { var: "center.slug", as: "id" },
            { var: "center.title", as: "name" },
            { var: "edge_type", as: "predicate" },
            { var: "neighbor.slug", as: "neighbor" },
          ],
        },
      },
      CTX,
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(out.columns).toEqual(["id", "name", "predicate", "neighbor"]);
    expect(out.rows).toEqual([
      { id: "d1", name: "D1", predicate: null, neighbor: null },
    ]);
  });

  it("merges out and in ego incident rows across multiple edge types", async () => {
    const read = vi.fn(async (input: ReadInput) => {
      if (input.query_name === "decision_neighbors_center") {
        return readOutput([
          { id: "d1", name: "D1", __ng_center_id: "d1" },
          { id: "d2", name: "D2", __ng_center_id: "d2" },
        ]);
      }
      if (input.query_name === "decision_neighbors_out_GovernedBy") {
        return readOutput([
          {
            id: "d1",
            name: "D1",
            predicate: "GovernedBy",
            direction: "out",
            neighbor: "policy-1",
            __ng_center_id: "d1",
          },
        ]);
      }
      if (input.query_name === "decision_neighbors_in_Owns") {
        return readOutput([
          {
            id: "d1",
            name: "D1",
            predicate: "Owns",
            direction: "in",
            neighbor: "andrew",
            __ng_center_id: "d1",
          },
        ]);
      }
      return readOutput([]);
    });
    const source = new ServerSource(fakeClient({ read }));
    const out = await source.read(
      {
        cellId: "decision-neighbors",
        fixtureQuery: {
          kind: "ego",
          center: { type: "Decision", where: {} },
          out: ["GovernedBy"],
          in: ["Owns"],
          project: [
            { var: "center.slug", as: "id" },
            { var: "center.title", as: "name" },
            { var: "edge_type", as: "predicate" },
            { var: "edge_direction", as: "direction" },
            { var: "neighbor.slug", as: "neighbor" },
          ],
        },
      },
      CTX,
    );

    expect(read).toHaveBeenCalledTimes(3);
    expect(out.rows).toEqual([
      {
        id: "d1",
        name: "D1",
        predicate: "GovernedBy",
        direction: "out",
        neighbor: "policy-1",
      },
      {
        id: "d1",
        name: "D1",
        predicate: "Owns",
        direction: "in",
        neighbor: "andrew",
      },
      {
        id: "d2",
        name: "D2",
        predicate: null,
        direction: null,
        neighbor: null,
      },
    ]);
  });

  it("passes resolved params into generated ego reads", async () => {
    const read = vi.fn(async () => readOutput([]));
    const source = new ServerSource(fakeClient({ read }));
    await source.read(
      {
        cellId: "decision-neighbors",
        params: { actor: "andrew" },
        fixtureQuery: {
          kind: "ego",
          center: { type: "Decision", where: { slug: "d1" } },
          out: ["GovernedBy"],
          in: [],
          project: [{ var: "center.slug", as: "id" }],
        },
      },
      CTX,
    );
    expect(read.mock.calls[0]?.[0].params).toMatchObject({
      actor: "andrew",
      w_slug: "d1",
    });
    expect(read.mock.calls[1]?.[0].params).toMatchObject({
      actor: "andrew",
      w_slug: "d1",
    });
  });

  it("rejects unsupported server ego projections clearly", async () => {
    const source = new ServerSource(fakeClient({}));
    await expect(
      source.read(
        {
          cellId: "bad-ego",
          fixtureQuery: {
            kind: "ego",
            center: { type: "Decision", where: {} },
            out: ["Owns"],
            in: [],
            project: [{ var: "edge.weight", as: "weight" }],
          },
        },
        CTX,
      ),
    ).rejects.toThrow(/not supported in server mode/);
  });

  it("uses mutation write target branch from runtime context", async () => {
    const change = vi.fn(async () => ({
      branch: "review",
      query_name: "ng_mutate",
      affected_nodes: 1,
      affected_edges: 0,
    }));
    const source = new ServerSource(fakeClient({ change }), { branch: "main" });
    const context: MutationContext = {
      readTarget: { snapshot: "snap" },
      writeTarget: { branch: "review" },
      state: {},
    };
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
      context,
    );
    expect(change.mock.calls[0]?.[0]).toMatchObject({ branch: "review" });
  });

  it("falls back to ServerSource default branch when runtime has no write branch", async () => {
    const change = vi.fn(async () => ({
      branch: "main",
      query_name: "ng_mutate",
      affected_nodes: 1,
      affected_edges: 0,
    }));
    const source = new ServerSource(fakeClient({ change }), { branch: "main" });
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
      { readTarget: { snapshot: "snap" }, writeTarget: {}, state: {} },
    );
    expect(change.mock.calls[0]?.[0]).toMatchObject({ branch: "main" });
  });
});

function fakeClient(overrides: {
  read?: (input: ReadInput) => Promise<ReturnType<typeof readOutput>>;
  change?: (input: ChangeInput) => Promise<{
    branch: string;
    query_name: string;
    affected_nodes: number;
    affected_edges: number;
  }>;
}): Client {
  return {
    read: overrides.read ?? (async () => readOutput([])),
    change:
      overrides.change ??
      (async () => ({
        branch: "main",
        query_name: "q",
        affected_nodes: 0,
        affected_edges: 0,
      })),
  } as unknown as Client;
}

function readOutput(rows: Record<string, unknown>[]) {
  return {
    query_name: "q",
    target: "main",
    row_count: rows.length,
    columns: [],
    rows,
  };
}
