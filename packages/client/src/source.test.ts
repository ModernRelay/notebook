import { describe, it, expect, vi } from "vitest";
import type { Client, QueryInput, MutateInput } from "./http.js";
import { ServerSource } from "./source.js";
import type { ExecutionContext, MutationContext } from "@modernrelay/notebook-core";

const CTX: ExecutionContext = {
  cellId: "cell",
  readTarget: {},
  state: {},
};

describe("ServerSource", () => {
  it("declares runtime capabilities", () => {
    const source = new ServerSource(fakeClient({}));
    expect(source.capabilities()).toMatchObject({
      namedQueries: true,
      rawGq: true,
      mutationKinds: ["set_field"],
      branchReads: true,
      snapshotReads: true,
      branchWrites: true,
    });
  });

  it("invokes a catalog query by ref with params + target", async () => {
    const invoke = vi.fn(async () => readOutput([{ id: "d1" }]));
    const source = new ServerSource(fakeClient({ invoke }), { branch: "main" });
    const out = await source.read(
      {
        cellId: "decisions",
        queryRef: "decisions_by_urgency",
        params: { status: "open" },
      },
      CTX,
    );
    expect(invoke.mock.calls[0]?.[0]).toBe("decisions_by_urgency");
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      params: { status: "open" },
      branch: "main",
    });
    expect(out.rows).toEqual([{ id: "d1" }]);
  });

  it("passes raw .gq through the escape hatch via query", async () => {
    const query = vi.fn(async () => readOutput([]));
    const source = new ServerSource(fakeClient({ query }));
    await source.read(
      {
        cellId: "raw",
        querySource:
          "query q() { match { $d: Decision } return { $d.slug as slug } }",
        queryName: "q",
      },
      CTX,
    );
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      query: expect.stringContaining("query q"),
      name: "q",
    });
  });

  it("throws when a read has neither ref nor rawGq", async () => {
    const source = new ServerSource(fakeClient({}));
    await expect(source.read({ cellId: "bad" }, CTX)).rejects.toThrow(/neither/);
  });

  it("uses mutation write target branch from runtime context", async () => {
    const mutate = vi.fn(async () => ({
      branch: "review",
      query_name: "ng_mutate",
      affected_nodes: 1,
      affected_edges: 0,
    }));
    const source = new ServerSource(fakeClient({ mutate }), { branch: "main" });
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
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ branch: "review" });
  });

  it("falls back to ServerSource default branch when runtime has no write branch", async () => {
    const mutate = vi.fn(async () => ({
      branch: "main",
      query_name: "ng_mutate",
      affected_nodes: 1,
      affected_edges: 0,
    }));
    const source = new ServerSource(fakeClient({ mutate }), { branch: "main" });
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
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ branch: "main" });
  });
});

function fakeClient(overrides: {
  invoke?: (
    name: string,
    input: { params?: Record<string, unknown>; branch?: string; snapshot?: string },
  ) => Promise<ReturnType<typeof readOutput>>;
  query?: (input: QueryInput) => Promise<ReturnType<typeof readOutput>>;
  mutate?: (input: MutateInput) => Promise<{
    branch: string;
    query_name: string;
    affected_nodes: number;
    affected_edges: number;
  }>;
}): Client {
  return {
    invoke: overrides.invoke ?? (async () => readOutput([])),
    query: overrides.query ?? (async () => readOutput([])),
    mutate:
      overrides.mutate ??
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
