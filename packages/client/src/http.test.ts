import { describe, it, expect } from "vitest";
import { Client, OmnigraphHttpError } from "./http.js";

// Regexes copied from packages/web/src/error-classifier.ts — the message
// contract this facade must preserve when re-wrapping SDK errors. (web is
// not a dependency of @modernrelay/notebook-client, so we assert against copies.)
const RE_UNAUTHORIZED = /returned 401|"code"\s*:\s*"unauthorized"/i;
const RE_NETWORK = /Failed to fetch|NetworkError|TypeError: NetworkError|net::ERR/i;
const RE_CONFLICT = /stale view of.*expected manifest table version|ExpectedVersionMismatch/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(res: Response): typeof fetch {
  return (async () => res) as unknown as typeof fetch;
}

function clientWith(fetchImpl: typeof fetch): Client {
  // graphId is required under omnigraph-server 0.7.0 (cluster-only): without it
  // the facade's `requireGraph` guard throws before reaching `fetchImpl`.
  return new Client({
    baseUrl: "http://omnigraph.test",
    graphId: "company",
    fetchImpl,
  });
}

describe("Client (SDK-backed facade)", () => {
  it("reshapes a successful /query response to colombo's snake_case ReadOutput", async () => {
    const client = clientWith(
      fetchReturning(
        jsonResponse({
          query_name: "q",
          target: { branch: "main", snapshot: null },
          row_count: 2,
          columns: ["slug"],
          rows: [{ slug: "a" }, { slug: "b" }],
        }),
      ),
    );
    const out = await client.query({ query: "query q() { ... }", name: "q" });
    expect(out).toEqual({
      query_name: "q",
      target: "main",
      row_count: 2,
      columns: ["slug"],
      rows: [{ slug: "a" }, { slug: "b" }],
    });
  });

  it("defaults columns/rows and coerces a snapshot target to a string", async () => {
    const client = clientWith(
      fetchReturning(
        jsonResponse({
          query_name: "q",
          target: { branch: null, snapshot: "snap-1" },
          row_count: 0,
        }),
      ),
    );
    const out = await client.query({ query: "q" });
    expect(out.target).toBe("snap-1");
    expect(out.columns).toEqual([]);
    expect(out.rows).toEqual([]);
  });

  it("reshapes /mutate and omits actor_id when null", async () => {
    const client = clientWith(
      fetchReturning(
        jsonResponse({
          branch: "review",
          query_name: "m",
          affected_nodes: 1,
          affected_edges: 0,
          actor_id: null,
        }),
      ),
    );
    const out = await client.mutate({ query: "update ...", name: "m" });
    expect(out).toEqual({
      branch: "review",
      query_name: "m",
      affected_nodes: 1,
      affected_edges: 0,
    });
  });

  it("reshapes /queries catalog entries to snake_case", async () => {
    const client = clientWith(
      fetchReturning(
        jsonResponse({
          queries: [
            {
              name: "decisions_by_urgency",
              tool_name: "decisions_by_urgency",
              mutation: false,
              description: "Decisions",
              instruction: null,
              params: [
                {
                  name: "status",
                  kind: "string",
                  nullable: true,
                  item_kind: null,
                  vector_dim: null,
                },
              ],
            },
          ],
        }),
      ),
    );
    await expect(client.queries()).resolves.toEqual({
      queries: [
        {
          name: "decisions_by_urgency",
          tool_name: "decisions_by_urgency",
          mutation: false,
          description: "Decisions",
          instruction: null,
          params: [
            {
              name: "status",
              kind: "string",
              nullable: true,
              item_kind: null,
              vector_dim: null,
            },
          ],
        },
      ],
    });
  });

  it("wraps a 401 as OmnigraphHttpError matching the permission classifier", async () => {
    const client = clientWith(
      fetchReturning(jsonResponse({ error: "bad token", code: "unauthorized" }, 401)),
    );
    const err = await client.query({ query: "q" }).catch((e) => e);
    expect(err).toBeInstanceOf(OmnigraphHttpError);
    expect(err.message).toMatch(/returned 401/);
    expect(err.message).toMatch(RE_UNAUTHORIZED);
    expect(err.message).toMatch(/"code"\s*:\s*"unauthorized"/);
  });

  it("wraps a network failure so the network classifier fires", async () => {
    const client = clientWith(
      (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    );
    const err = await client.query({ query: "q" }).catch((e) => e);
    expect(err).toBeInstanceOf(OmnigraphHttpError);
    expect(err.message).toMatch(RE_NETWORK);
  });

  it("fails fast (no fetch) when no graphId is set — cluster-only 0.7.0", async () => {
    const client = new Client({
      baseUrl: "http://omnigraph.test",
      fetchImpl: (async () => {
        throw new Error("fetch should not be called");
      }) as unknown as typeof fetch,
    });
    const err = await client.query({ query: "q" }).catch((e) => e);
    expect(err).toBeInstanceOf(OmnigraphHttpError);
    expect(err.message).toMatch(/graphId is required/i);
  });

  it("preserves the server error text so the conflict classifier fires", async () => {
    const client = clientWith(
      fetchReturning(
        jsonResponse(
          {
            error:
              "storage: stale view of table nodes/PolicyClause expected manifest table version 5",
            code: "conflict",
          },
          409,
        ),
      ),
    );
    const err = await client.mutate({ query: "update ..." }).catch((e) => e);
    expect(err).toBeInstanceOf(OmnigraphHttpError);
    expect(err.message).toMatch(RE_CONFLICT);
  });
});

describe("branch staging surface", () => {
  it("createBranch posts and resolves; a 409 (name exists) surfaces as OmnigraphHttpError", async () => {
    const ok = clientWith(
      fetchReturning(
        jsonResponse({ uri: "og://g", from: "main", name: "stage", actor_id: null }),
      ),
    );
    await expect(ok.createBranch("stage")).resolves.toBeUndefined();

    const exists = clientWith(
      fetchReturning(
        jsonResponse({ error: "branch 'stage' already exists", code: "conflict" }, 409),
      ),
    );
    await expect(exists.createBranch("stage")).rejects.toMatchObject({
      name: "OmnigraphHttpError",
      status: 409,
    });
  });

  it("mergeBranch maps the three success outcomes", async () => {
    for (const outcome of ["already_up_to_date", "fast_forward", "merged"]) {
      const client = clientWith(
        fetchReturning(
          jsonResponse({ source: "stage", target: "main", outcome, actor_id: null }),
        ),
      );
      await expect(client.mergeBranch("stage")).resolves.toEqual({
        ok: true,
        outcome,
      });
    }
  });

  it("mergeBranch turns a 409 with merge_conflicts into {ok:false, conflicts}", async () => {
    const client = clientWith(
      fetchReturning(
        jsonResponse(
          {
            error: "merge conflicts",
            code: "conflict",
            merge_conflicts: [
              {
                table_key: "node:Task",
                row_id: "t1",
                kind: "DivergentUpdate",
                message: "status changed on both branches",
              },
              {
                table_key: "edge:AssignedTo",
                row_id: null,
                kind: "OrphanEdge",
                message: "edge target deleted on main",
              },
            ],
          },
          409,
        ),
      ),
    );
    const result = await client.mergeBranch("stage", "main");
    expect(result).toEqual({
      ok: false,
      conflicts: [
        {
          table_key: "node:Task",
          row_id: "t1",
          kind: "DivergentUpdate",
          message: "status changed on both branches",
        },
        {
          table_key: "edge:AssignedTo",
          kind: "OrphanEdge",
          message: "edge target deleted on main",
        },
      ],
    });
  });

  it("deleteBranch resolves on 2xx", async () => {
    const client = clientWith(
      fetchReturning(jsonResponse({ uri: "og://g", name: "stage", actor_id: null })),
    );
    await expect(client.deleteBranch("stage")).resolves.toBeUndefined();
  });

  it("snapshot reshapes tables to {table_key, version, row_count}", async () => {
    const client = clientWith(
      fetchReturning(
        jsonResponse({
          branch: "stage",
          manifest_version: 7,
          tables: [
            {
              table_key: "node:Task",
              table_path: "tables/task",
              table_version: 16,
              table_branch: "stage",
              row_count: 12,
            },
            {
              table_key: "node:Comment",
              table_path: "tables/comment",
              table_version: 9,
              table_branch: null,
              row_count: 4,
            },
          ],
        }),
      ),
    );
    await expect(client.snapshot("stage")).resolves.toEqual({
      branch: "stage",
      manifest_version: 7,
      tables: [
        { table_key: "node:Task", version: 16, row_count: 12, writer: "stage" },
        { table_key: "node:Comment", version: 9, row_count: 4, writer: null },
      ],
    });
  });
});
