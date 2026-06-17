/**
 * Thin facade over the official omnigraph SDK (`@modernrelay/omnigraph`).
 *
 * The SDK owns the HTTP transport, the OpenAPI-faithful types, and typed
 * error classes. This `Client` keeps colombo's stable, snake_case surface
 * (`query`/`mutate`/`branches`/`healthz` + `OmnigraphHttpError`) so the
 * `ServerSource` adapter, its tests, and the web error-classifier are
 * unaffected by the SDK swap. It reshapes the SDK's camelCase responses
 * back to colombo's shapes and re-wraps thrown SDK errors as
 * `OmnigraphHttpError` to preserve the message contract the UI matches on.
 */

import {
  Omnigraph,
  NetworkError,
  OmnigraphError,
  type QueryInput as SdkQueryInput,
  type MutationInput as SdkMutationInput,
} from "@modernrelay/omnigraph";

export interface ClientOptions {
  baseUrl: string;
  /** Bearer token. Falls back to `OMNIGRAPH_TOKEN` env var when unset. */
  token?: string;
  /**
   * Cluster graph id. omnigraph-server 0.7.0+ is cluster-only: every read and
   * mutation is served under `/graphs/{graphId}/…`, so a graph id is required.
   * Without one the SDK throws `ConfigurationError` before issuing any request.
   * Only `health()` (the flat `/healthz` route) works graph-id-free.
   */
  graphId?: string;
  fetchImpl?: typeof fetch;
}

export interface QueryInput {
  query: string;
  name?: string;
  params?: Record<string, unknown>;
  branch?: string;
  snapshot?: string;
}

export interface ReadOutput {
  query_name: string;
  target: string;
  row_count: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface MutateInput {
  query: string;
  name?: string;
  params?: Record<string, unknown>;
  branch?: string;
}

export interface ChangeOutput {
  branch: string;
  query_name: string;
  affected_nodes: number;
  affected_edges: number;
  actor_id?: string;
}

export interface BranchListOutput {
  branches: string[];
}

export class OmnigraphHttpError extends Error {
  constructor(
    public status: number,
    public path: string,
    public responseBody: string,
  ) {
    super(`omnigraph-server ${path} returned ${status}: ${responseBody}`);
    this.name = "OmnigraphHttpError";
  }
}

export class Client {
  private readonly og: Omnigraph;
  private readonly graphId: string | undefined;

  constructor(opts: ClientOptions) {
    const token =
      opts.token ??
      process.env.OMNIGRAPH_TOKEN ??
      process.env.OMNIGRAPH_BEARER_TOKEN;
    this.graphId = opts.graphId;
    this.og = new Omnigraph({
      baseUrl: opts.baseUrl,
      ...(token !== undefined ? { token } : {}),
      ...(opts.graphId !== undefined ? { graphId: opts.graphId } : {}),
      ...(opts.fetchImpl !== undefined ? { fetch: opts.fetchImpl } : {}),
    });
  }

  /**
   * Graph-scoped routes (query / mutate / branches) require a graph id under
   * omnigraph-server 0.7.0+ (cluster-only). Enforce that at the facade boundary
   * with a stable, owned `OmnigraphHttpError` rather than leaning on the SDK's
   * internal `ConfigurationError` wording. `healthz()` is exempt (the flat
   * `/healthz` route is graph-independent).
   */
  private requireGraph(path: string): void {
    if (this.graphId === undefined || this.graphId === "") {
      throw new OmnigraphHttpError(
        0,
        path,
        JSON.stringify({
          error:
            "graphId is required for graph-scoped operations — omnigraph-server " +
            "0.7.0+ is cluster-only. Pass { graphId } to new Client(...).",
        }),
      );
    }
  }

  async query(body: QueryInput, signal?: AbortSignal): Promise<ReadOutput> {
    this.requireGraph("/query");
    try {
      const r = await this.og.query(
        body as SdkQueryInput,
        signal ? { signal } : {},
      );
      return {
        query_name: r.queryName,
        target: r.target?.branch ?? r.target?.snapshot ?? "main",
        row_count: r.rowCount,
        columns: r.columns ?? [],
        rows: (r.rows ?? []) as Record<string, unknown>[],
      };
    } catch (e) {
      throw toHttpError(e, "/query");
    }
  }

  async mutate(body: MutateInput, signal?: AbortSignal): Promise<ChangeOutput> {
    this.requireGraph("/mutate");
    try {
      const r = await this.og.mutate(
        body as SdkMutationInput,
        signal ? { signal } : {},
      );
      return {
        branch: r.branch,
        query_name: r.queryName,
        affected_nodes: r.affectedNodes,
        affected_edges: r.affectedEdges,
        ...(r.actorId != null ? { actor_id: r.actorId } : {}),
      };
    } catch (e) {
      throw toHttpError(e, "/mutate");
    }
  }

  async branches(): Promise<BranchListOutput> {
    this.requireGraph("/branches");
    try {
      return { branches: await this.og.branches.list() };
    } catch (e) {
      throw toHttpError(e, "/branches");
    }
  }

  async healthz(): Promise<void> {
    try {
      await this.og.health();
    } catch (e) {
      throw toHttpError(e, "/healthz");
    }
  }
}

/**
 * Normalize a thrown SDK error into `OmnigraphHttpError`, preserving the
 * message format (`omnigraph-server <path> returned <status>: <body>`) and
 * embedding the server `code` so the web error-classifier's regexes still
 * fire. AbortError is re-thrown unchanged so the runtime's cancellation
 * logic still recognizes it.
 */
function toHttpError(e: unknown, path: string): unknown {
  if (e instanceof Error && e.name === "AbortError") return e;
  if (e instanceof NetworkError) {
    return new OmnigraphHttpError(
      0,
      path,
      JSON.stringify({ error: `Failed to fetch — ${e.message}` }),
    );
  }
  if (e instanceof OmnigraphError) {
    return new OmnigraphHttpError(
      e.status,
      path,
      JSON.stringify({
        error: e.message,
        ...(e.code ? { code: e.code } : {}),
      }),
    );
  }
  const message = e instanceof Error ? e.message : String(e);
  return new OmnigraphHttpError(0, path, JSON.stringify({ error: message }));
}
