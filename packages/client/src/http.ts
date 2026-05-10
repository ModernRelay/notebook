/**
 * Thin HTTP client for omnigraph-server. Maps directly onto the OpenAPI
 * surface — no translation, no business logic. The `ServerSource` wrapper
 * on top translates fixture-DSL queries and MutationSpec into `.gq`.
 */

export interface ClientOptions {
  baseUrl: string;
  /** Bearer token. Falls back to `OMNIGRAPH_TOKEN` env var when unset. */
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface ReadInput {
  query_source: string;
  query_name?: string;
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

export interface ChangeInput {
  query_source: string;
  query_name?: string;
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
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token ?? process.env.OMNIGRAPH_TOKEN;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  read(body: ReadInput): Promise<ReadOutput> {
    return this.json<ReadOutput>("POST", "/read", body);
  }

  /**
   * One-shot mutation. The server commits exactly one manifest version
   * for the touched tables (atomic per call; cross-table OCC enforced via
   * ManifestBatchPublisher CAS). Returns 409 with conflict details on
   * concurrent-write loss.
   */
  change(body: ChangeInput): Promise<ChangeOutput> {
    return this.json<ChangeOutput>("POST", "/change", body);
  }

  branches(): Promise<BranchListOutput> {
    return this.json<BranchListOutput>("GET", "/branches");
  }

  async healthz(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/healthz`, {
      method: "GET",
    });
    if (!res.ok) {
      throw new OmnigraphHttpError(res.status, "/healthz", await res.text());
    }
  }

  private async json<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new OmnigraphHttpError(res.status, path, text);
    }
    return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  }
}
