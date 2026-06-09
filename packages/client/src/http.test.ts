import { describe, it, expect } from "vitest";
import { Client, OmnigraphHttpError } from "./http.js";

// Regexes copied from packages/web/src/error-classifier.ts — the message
// contract this facade must preserve when re-wrapping SDK errors. (web is
// not a dependency of @omnigraph/client, so we assert against copies.)
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
  return new Client({ baseUrl: "http://omnigraph.test", fetchImpl });
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
