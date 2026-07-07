/**
 * Thin facade over the official omnigraph SDK (`@modernrelay/omnigraph`).
 *
 * The SDK owns the HTTP transport, the OpenAPI-faithful types, and typed
 * error classes. This `Client` keeps colombo's stable, snake_case surface
 * (`query`/`queries`/`mutate`/`branches`/`healthz` + `OmnigraphHttpError`) so the
 * `ServerSource` adapter, its tests, and the web error-classifier are
 * unaffected by the SDK swap. It reshapes the SDK's camelCase responses
 * back to colombo's shapes and re-wraps thrown SDK errors as
 * `OmnigraphHttpError` to preserve the message contract the UI matches on.
 */

import {
  Omnigraph,
  ConflictError,
  NetworkError,
  OmnigraphError,
  type QueryInput as SdkQueryInput,
  type MutationInput as SdkMutationInput,
  type Read as SdkRead,
  type Queries as SdkQueries,
} from "@modernrelay/omnigraph";

export interface ClientOptions {
  baseUrl: string;
  /**
   * Bearer token, supplied explicitly by the caller. Token resolution (flags,
   * `~/.omnigraph/credentials`, the `OMNIGRAPH_TOKEN_<SERVER>` /
   * `OMNIGRAPH_BEARER_TOKEN` chain) lives in the shared operator resolver
   * (`@modernrelay/notebook-client/node`); the Client reads no env itself.
   */
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

/** One structured conflict from an all-or-nothing merge attempt (409). */
export interface MergeConflictInfo {
  table_key: string;
  row_id?: string;
  kind: string;
  message: string;
}

/**
 * Merge result as a discriminated union: conflicts are an EXPECTED outcome of
 * reviewing staged work, not an exception — the target is untouched on
 * conflict, so callers render `conflicts` and keep going.
 */
export type BranchMergeResult =
  | { ok: true; outcome: "already_up_to_date" | "fast_forward" | "merged" }
  | { ok: false; conflicts: MergeConflictInfo[] };

/** Per-table manifest state on a branch — the table-level delta source. */
export interface SnapshotTableInfo {
  table_key: string;
  version: number;
  row_count: number;
  /**
   * The branch lineage that last wrote this table (null = the graph's main
   * lineage). Version numbers are per-lineage counters, so two DIVERGED
   * branches can share a version with different contents — the writer is
   * what disambiguates them.
   */
  writer: string | null;
}

export interface SnapshotOutput {
  branch: string;
  manifest_version: number;
  tables: SnapshotTableInfo[];
}

export type ParamKind =
  | "string"
  | "bool"
  | "int"
  | "bigint"
  | "float"
  | "date"
  | "datetime"
  | "blob"
  | "vector"
  | "list";

export interface ParamDescriptor {
  name: string;
  kind: ParamKind;
  nullable: boolean;
  item_kind?: ParamKind | null;
  vector_dim?: number | null;
}

export interface QueryCatalogEntry {
  name: string;
  tool_name: string;
  mutation: boolean;
  description?: string | null;
  instruction?: string | null;
  params: ParamDescriptor[];
}

export interface QueriesOutput {
  queries: QueryCatalogEntry[];
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
    // No env fallback here — the caller passes an already-resolved token (see
    // the operator resolver). Keeps token resolution in one place (canon §4.7).
    const token = opts.token;
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

  /**
   * Invoke a server-owned catalog query by name (`POST /queries/{name}`). The
   * query body lives in the cluster registry, not here — we pass only runtime
   * inputs. `expectMutation: false` asserts a read (the server rejects a stored
   * mutation), so the untagged `Read | Change` response is a read envelope.
   */
  async invoke(
    name: string,
    input: { params?: Record<string, unknown>; branch?: string; snapshot?: string },
    signal?: AbortSignal,
  ): Promise<ReadOutput> {
    this.requireGraph(`/queries/${name}`);
    try {
      const r = (await this.og.queries.invoke(
        name,
        {
          expectMutation: false,
          ...(input.params !== undefined ? { params: input.params } : {}),
          ...(input.branch !== undefined ? { branch: input.branch } : {}),
          ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
        },
        signal ? { signal } : {},
      )) as SdkRead;
      return {
        query_name: r.queryName,
        target: r.target?.branch ?? r.target?.snapshot ?? "main",
        row_count: r.rowCount,
        columns: r.columns ?? [],
        rows: (r.rows ?? []) as Record<string, unknown>[],
      };
    } catch (e) {
      throw toHttpError(e, `/queries/${name}`);
    }
  }

  /**
   * Invoke a server-owned catalog MUTATION by name (`POST /queries/{name}` with
   * `expectMutation: true`). The mutation body lives in the cluster registry; we
   * pass only runtime inputs. The untagged `Read | Change` response is a change
   * envelope here. `snapshot` is intentionally unsupported — the server rejects
   * it for stored mutations (writes target a branch).
   */
  async invokeMutation(
    name: string,
    input: { params?: Record<string, unknown>; branch?: string },
    signal?: AbortSignal,
  ): Promise<ChangeOutput> {
    this.requireGraph(`/queries/${name}`);
    try {
      const r = (await this.og.queries.invoke(
        name,
        {
          expectMutation: true,
          ...(input.params !== undefined ? { params: input.params } : {}),
          ...(input.branch !== undefined ? { branch: input.branch } : {}),
        },
        signal ? { signal } : {},
      )) as {
        branch: string;
        queryName: string;
        affectedNodes: number;
        affectedEdges: number;
        actorId?: string | null;
      };
      return {
        branch: r.branch,
        query_name: r.queryName,
        affected_nodes: r.affectedNodes,
        affected_edges: r.affectedEdges,
        ...(r.actorId != null ? { actor_id: r.actorId } : {}),
      };
    } catch (e) {
      throw toHttpError(e, `/queries/${name}`);
    }
  }

  async queries(): Promise<QueriesOutput> {
    this.requireGraph("/queries");
    try {
      const r: SdkQueries = await this.og.queries.list();
      return {
        queries: r.queries.map((q) => ({
          name: q.name,
          tool_name: q.toolName,
          mutation: q.mutation,
          ...(q.description !== undefined ? { description: q.description } : {}),
          ...(q.instruction !== undefined ? { instruction: q.instruction } : {}),
          params: q.params.map((p) => ({
            name: p.name,
            kind: p.kind,
            nullable: p.nullable,
            ...(p.itemKind !== undefined ? { item_kind: p.itemKind } : {}),
            ...(p.vectorDim !== undefined ? { vector_dim: p.vectorDim } : {}),
          })),
        })),
      };
    } catch (e) {
      throw toHttpError(e, "/queries");
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

  /**
   * Fork `name` off `from` (server default: main). A name collision surfaces
   * as the usual 409 `OmnigraphHttpError` — callers that want "switch to the
   * existing branch instead" match on `status === 409`.
   */
  async createBranch(
    name: string,
    from?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.requireGraph("/branches");
    try {
      await this.og.branches.create(
        { name, ...(from !== undefined ? { from } : {}) },
        signal ? { signal } : {},
      );
    } catch (e) {
      throw toHttpError(e, "/branches");
    }
  }

  /**
   * Merge `source` into `target` (server default: main). Three-way and
   * all-or-nothing: on conflict nothing is published and the structured
   * conflict list comes back as `{ok: false}` rather than a throw.
   */
  async mergeBranch(
    source: string,
    target?: string,
    signal?: AbortSignal,
  ): Promise<BranchMergeResult> {
    this.requireGraph("/branches/merge");
    try {
      const r = await this.og.branches.merge(
        { source, ...(target !== undefined ? { target } : {}) },
        signal ? { signal } : {},
      );
      return {
        ok: true,
        outcome: r.outcome as "already_up_to_date" | "fast_forward" | "merged",
      };
    } catch (e) {
      if (e instanceof ConflictError) {
        // SDK 0.7.0 reads `body?.mergeConflicts` but the server sends
        // snake_case `merge_conflicts` (error bodies aren't camelized), so
        // `e.mergeConflicts` is always undefined — fall back to the raw body.
        const raw = (e.body as { merge_conflicts?: unknown } | undefined)
          ?.merge_conflicts;
        const entries =
          e.mergeConflicts?.map((c) => ({
            table_key: c.tableKey,
            ...(c.rowId != null ? { row_id: c.rowId } : {}),
            kind: String(c.kind),
            message: c.message,
          })) ??
          (Array.isArray(raw)
            ? (raw as Record<string, unknown>[]).map((c) => ({
                table_key: String(c.table_key ?? ""),
                ...(c.row_id != null ? { row_id: String(c.row_id) } : {}),
                kind: String(c.kind ?? "conflict"),
                message: String(c.message ?? ""),
              }))
            : undefined);
        if (entries !== undefined) return { ok: false, conflicts: entries };
      }
      throw toHttpError(e, "/branches/merge");
    }
  }

  /** Delete a branch pointer. Idempotent server-side (missing = no-op). */
  async deleteBranch(name: string, signal?: AbortSignal): Promise<void> {
    this.requireGraph(`/branches/${name}`);
    try {
      await this.og.branches.delete(name, signal ? { signal } : {});
    } catch (e) {
      throw toHttpError(e, `/branches/${name}`);
    }
  }

  /**
   * Latest-commit manifest state of a branch: per-table version + row count.
   * Two snapshots (branch vs its base) make the table-level change summary.
   */
  async snapshot(branch?: string, signal?: AbortSignal): Promise<SnapshotOutput> {
    this.requireGraph("/snapshot");
    try {
      const r = await this.og.snapshot(
        branch !== undefined ? { branch } : {},
        signal ? { signal } : {},
      );
      return {
        branch: r.branch,
        manifest_version: r.manifestVersion,
        tables: r.tables.map((t) => ({
          table_key: t.tableKey,
          version: t.tableVersion,
          row_count: t.rowCount,
          writer: t.tableBranch ?? null,
        })),
      };
    } catch (e) {
      throw toHttpError(e, "/snapshot");
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
