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
  it("declares runtime capabilities; rawGq is off by default", () => {
    const source = new ServerSource(fakeClient({}));
    expect(source.capabilities()).toMatchObject({
      namedQueries: true,
      rawGq: false,
      branchReads: true,
      snapshotReads: true,
      branchWrites: true,
    });
  });

  it("advertises rawGq only when the escape hatch is enabled", () => {
    expect(
      new ServerSource(fakeClient({}), { allowRawGq: true }).capabilities().rawGq,
    ).toBe(true);
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

  it("invokes a catalog mutation by ref with resolved params + write branch", async () => {
    const invokeMutation = vi.fn(async () => changeOutput("review"));
    const source = new ServerSource(fakeClient({ invokeMutation }), {
      branch: "main",
    });
    const context: MutationContext = {
      readTarget: { snapshot: "snap" },
      writeTarget: { branch: "review" },
      state: {},
    };
    await source.mutate(
      {
        params: {
          spec: {
            ref: "approve_policy_clause",
            params: { clause: { $row: "id" } },
          },
          row: { id: "pdr-c1" },
          rowKey: "pdr-c1",
        },
        resolvedParams: { clause: "pdr-c1" },
      },
      context,
    );
    // No client-side .gq is ever constructed; identity is just a typed param.
    expect(invokeMutation.mock.calls[0]?.[0]).toBe("approve_policy_clause");
    expect(invokeMutation.mock.calls[0]?.[1]).toMatchObject({
      params: { clause: "pdr-c1" },
      branch: "review",
    });
  });

  it("falls back to ServerSource default branch when runtime has no write branch", async () => {
    const invokeMutation = vi.fn(async () => changeOutput("main"));
    const source = new ServerSource(fakeClient({ invokeMutation }), {
      branch: "main",
    });
    await source.mutate(
      {
        params: {
          spec: { ref: "approve_policy_clause" },
          row: {},
          rowKey: "pdr-c1",
        },
        resolvedParams: {},
      },
      { readTarget: { snapshot: "snap" }, writeTarget: {}, state: {} },
    );
    expect(invokeMutation.mock.calls[0]?.[1]).toMatchObject({ branch: "main" });
  });

  it("works for a non-slug key — the client builds no predicate", async () => {
    // A graph keyed on `email`: the mutation query owns `where email = $person`;
    // the client only forwards the resolved param. No `where slug =` anywhere.
    const invokeMutation = vi.fn(async () => changeOutput("main"));
    const source = new ServerSource(fakeClient({ invokeMutation }));
    await source.mutate(
      {
        params: {
          spec: { ref: "deactivate_user", params: { person: { $row: "id" } } },
          row: { id: "ada@example.com" },
          rowKey: "ada@example.com",
        },
        resolvedParams: { person: "ada@example.com" },
      },
      { readTarget: {}, writeTarget: {}, state: {} },
    );
    expect(invokeMutation.mock.calls[0]?.[1]).toMatchObject({
      params: { person: "ada@example.com" },
    });
  });

  it("sends an inline rawGq mutation ad-hoc via client.mutate", async () => {
    const mutate = vi.fn(async () => changeOutput("main"));
    const source = new ServerSource(fakeClient({ mutate }));
    await source.mutate(
      {
        params: {
          spec: {
            rawGq:
              'query qf($id: String){ update Issue set { status: "closed" } where slug = $id }',
            params: { id: { $row: "id" } },
          },
          row: { id: "cold-start-latency" },
          rowKey: "cold-start-latency",
        },
        resolvedParams: { id: "cold-start-latency" },
      },
      { readTarget: {}, writeTarget: {}, state: {} },
    );
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      query: expect.stringContaining("update Issue"),
      params: { id: "cold-start-latency" },
    });
  });
});

function fakeClient(overrides: {
  invoke?: (
    name: string,
    input: { params?: Record<string, unknown>; branch?: string; snapshot?: string },
  ) => Promise<ReturnType<typeof readOutput>>;
  invokeMutation?: (
    name: string,
    input: { params?: Record<string, unknown>; branch?: string },
  ) => Promise<ReturnType<typeof changeOutput>>;
  query?: (input: QueryInput) => Promise<ReturnType<typeof readOutput>>;
  mutate?: (input: MutateInput) => Promise<ReturnType<typeof changeOutput>>;
}): Client {
  return {
    invoke: overrides.invoke ?? (async () => readOutput([])),
    invokeMutation:
      overrides.invokeMutation ?? (async () => changeOutput("main")),
    query: overrides.query ?? (async () => readOutput([])),
    mutate: overrides.mutate ?? (async () => changeOutput("main")),
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

function changeOutput(branch: string) {
  return {
    branch,
    query_name: "m",
    affected_nodes: 1,
    affected_edges: 0,
  };
}

describe("ServerSource.mutate — result plumbing", () => {
  it("returns the server's affected counts for a catalog ref mutation", async () => {
    const invokeMutation = vi.fn(async () => ({
      branch: "main",
      query_name: "approve",
      affected_nodes: 2,
      affected_edges: 1,
    }));
    const source = new ServerSource(fakeClient({ invokeMutation }));
    const result = await source.mutate(
      {
        params: { spec: { ref: "approve" } },
        resolvedParams: {},
      },
      { readTarget: {}, writeTarget: {}, state: {} },
    );
    expect(result).toEqual({ kind: "ok", affected: { nodes: 2, edges: 1 } });
  });

  it("returns affected counts for the rawGq escape hatch too (0 = no-op visible)", async () => {
    const mutate = vi.fn(async () => ({
      branch: "main",
      query_name: "m",
      affected_nodes: 0,
      affected_edges: 0,
    }));
    const source = new ServerSource(fakeClient({ mutate }), {
      allowRawGq: true,
    });
    const result = await source.mutate(
      {
        params: { spec: { rawGq: "query m($x: String){ update T set { a: $x } where slug = $x }" } },
        resolvedParams: { x: "nope" },
      },
      { readTarget: {}, writeTarget: {}, state: {} },
    );
    expect(result).toEqual({ kind: "ok", affected: { nodes: 0, edges: 0 } });
  });
});
