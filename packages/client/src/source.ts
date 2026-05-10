/**
 * `ServerSource` — the executor's `Source` impl backed by an HTTP client
 * to omnigraph-server.
 *
 *   read(input)  →  translate fixture-DSL → POST /read    →  ReadOutput
 *   mutate(spec) →  translate MutationSpec → POST /change →  MutationResult
 *
 * The notebook YAML stays identical between fixture mode and server mode;
 * the App picks the Source impl by looking at notebook.fixture vs
 * notebook.server.
 */

import type {
  ReadInput as ExecutorReadInput,
  ReadOutput as ExecutorReadOutput,
  Source,
} from "@omnigraph/executor";
import type { MutationParams, MutationResult } from "@omnigraph/notebook-spec";
import { Client, type ChangeOutput } from "./http.js";
import { translateFixtureQuery, translateMutation } from "./translate.js";

export interface ServerSourceOptions {
  /** Default branch for reads + writes. CLI flag and notebook field win over this. */
  branch?: string;
}

export class ServerSource implements Source {
  constructor(
    private readonly client: Client,
    private readonly opts: ServerSourceOptions = {},
  ) {}

  async read(input: ExecutorReadInput): Promise<ExecutorReadOutput> {
    if (!input.fixture_query) {
      // The cell declared `query.source` directly — pass it through.
      if (input.query_source === undefined) {
        throw new Error(
          "ServerSource.read: cell has no fixture_query and no query_source",
        );
      }
      const out = await this.client.read({
        query_source: input.query_source,
        ...(input.query_name !== undefined && { query_name: input.query_name }),
        ...(input.params !== undefined && { params: input.params }),
        ...this.targetTriple(input),
      });
      return out;
    }
    const translated = translateFixtureQuery(
      input.fixture_query,
      input.cell_id ?? "ng",
    );
    const params = mergeParams(translated.params, input.params);
    const out = await this.client.read({
      query_source: translated.query_source,
      query_name: translated.query_name,
      params,
      ...this.targetTriple(input),
    });
    return out;
  }

  async mutate(params: MutationParams): Promise<MutationResult> {
    const translated = translateMutation(params, "ng_mutate");
    const result: ChangeOutput = await this.client.change({
      query_source: translated.query_source,
      query_name: translated.query_name,
      params: translated.params,
      ...(this.opts.branch !== undefined && { branch: this.opts.branch }),
    });
    // Surface the affected counts in console for now; richer reporting goes
    // through MutationResult once we add fields to it (v0.8).
    void result;
    return { kind: "ok" };
  }

  private targetTriple(input: ExecutorReadInput): {
    branch?: string;
    snapshot?: string;
  } {
    const branch = input.branch ?? this.opts.branch;
    if (input.snapshot !== undefined) return { snapshot: input.snapshot };
    if (branch !== undefined) return { branch };
    return {};
  }
}

function mergeParams(
  base: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!extra || Object.keys(extra).length === 0) return base;
  return { ...base, ...extra };
}
