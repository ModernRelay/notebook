/**
 * `ServerSource` is the runtime Source backed by omnigraph-server.
 *
 * Reads are server-owned catalog queries invoked by name (`query.ref` →
 * `og.queries.invoke`). Raw `.gq` (`query.rawGq`) remains a capability-gated
 * escape hatch sent ad-hoc via `og.query`. No client-side query compilation.
 */

import type {
  ExecutionContext,
  MutationCommand,
  MutationContext,
  ReadOutput as RuntimeReadOutput,
  ReadRequest,
  Source,
  SourceCapabilities,
} from "@modernrelay/notebook-core";
import type { MutationResult } from "@modernrelay/notebook-core";
import { Client, type ChangeOutput } from "./http.js";

export interface ServerSourceOptions {
  /** Default branch for reads + writes. CLI flag and notebook field win over this. */
  branch?: string;
  /**
   * Allow the raw `.gq` escape hatch (`query.rawGq`). **Off by default** — in
   * production/operator contexts notebooks bind to server-owned catalog queries
   * (`query.ref`); raw `.gq` is a deliberate dev/CLI opt-in (canon §4.2). When
   * false, a notebook with a `rawGq` cell fails compatibility validation.
   */
  allowRawGq?: boolean;
}

export class ServerSource implements Source {
  constructor(
    private readonly client: Client,
    private readonly opts: ServerSourceOptions = {},
  ) {}

  capabilities(): SourceCapabilities {
    return {
      namedQueries: true,
      // Capability-gated, off by default (canon §4.2): gates the raw `.gq`
      // escape hatch for BOTH reads (query.rawGq) and writes (mutation.rawGq).
      rawGq: this.opts.allowRawGq ?? false,
      branchReads: true,
      snapshotReads: true,
      branchWrites: true,
    };
  }

  async read(
    input: ReadRequest,
    context: ExecutionContext,
  ): Promise<RuntimeReadOutput> {
    const target = this.targetTriple(input);

    // Canonical path: a server-owned catalog query invoked by name.
    if (input.queryRef !== undefined) {
      return this.client.invoke(
        input.queryRef,
        {
          ...(input.params !== undefined && { params: input.params }),
          ...target,
        },
        context.signal,
      );
    }

    // Escape hatch: raw `.gq` sent ad-hoc.
    if (input.querySource !== undefined) {
      return this.client.query(
        {
          query: input.querySource,
          ...(input.queryName !== undefined && { name: input.queryName }),
          ...(input.params !== undefined && { params: input.params }),
          ...target,
        },
        context.signal,
      );
    }

    throw new Error(
      "ServerSource.read: cell query has neither a catalog `ref` nor raw `rawGq`",
    );
  }

  async mutate(
    command: MutationCommand,
    context: MutationContext,
  ): Promise<MutationResult> {
    const { spec } = command.params;
    const branch = context.writeTarget.branch ?? this.opts.branch;
    const params = command.resolvedParams;

    // Canonical path: a server-owned catalog mutation invoked by name. The
    // mutation query owns its `where` clause, so identity is never built here.
    if (spec.ref !== undefined) {
      const result: ChangeOutput = await this.client.invokeMutation(
        spec.ref,
        {
          ...(Object.keys(params).length > 0 && { params }),
          ...(branch !== undefined && { branch }),
        },
        context.signal,
      );
      return {
        kind: "ok",
        affected: { nodes: result.affected_nodes, edges: result.affected_edges },
      };
    }

    // Escape hatch: author-written inline `.gq` sent ad-hoc via /mutate.
    if (spec.rawGq !== undefined) {
      const result: ChangeOutput = await this.client.mutate(
        {
          query: spec.rawGq,
          ...(spec.name !== undefined && { name: spec.name }),
          ...(Object.keys(params).length > 0 && { params }),
          ...(branch !== undefined && { branch }),
        },
        context.signal,
      );
      return {
        kind: "ok",
        affected: { nodes: result.affected_nodes, edges: result.affected_edges },
      };
    }

    throw new Error(
      "ServerSource.mutate: mutation has neither a catalog `ref` nor raw `rawGq`",
    );
  }

  private targetTriple(input: ReadRequest): {
    branch?: string;
    snapshot?: string;
  } {
    const branch = input.branch ?? this.opts.branch;
    if (input.snapshot !== undefined) return { snapshot: input.snapshot };
    if (branch !== undefined) return { branch };
    return {};
  }
}
