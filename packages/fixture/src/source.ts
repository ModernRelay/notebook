import type { MutationResult } from "@omnigraph/notebook-spec";
import type {
  ExecutionContext,
  MutationCommand,
  MutationContext,
  ReadOutput,
  ReadRequest,
  Source,
  SourceCapabilities,
} from "@omnigraph/runtime";
import type { Fixture } from "./validator.js";
import { runFixtureQuery } from "./runner.js";

export type FixtureReadInput = ReadRequest;
export type FixtureReadOutput = ReadOutput;

/**
 * In-memory source. Mutations update the underlying fixture object in
 * place — subsequent `read()` calls see the new state. The current
 * fixture mutates **per-process**: changes do not persist across TUI
 * restarts. (Future: optional writeback to disk.)
 */
export class FixtureSource implements Source {
  constructor(private readonly fixture: Fixture) {}

  capabilities(): SourceCapabilities {
    return {
      structuredQueryKinds: ["nodes", "path", "ego"],
      rawGq: false,
      mutationKinds: ["set_field"],
      branchReads: false,
      snapshotReads: false,
      branchWrites: false,
    };
  }

  async read(
    input: FixtureReadInput,
    _context: ExecutionContext,
  ): Promise<FixtureReadOutput> {
    if (!input.fixtureQuery) {
      throw new Error(
        "FixtureSource.read called without `fixture_query`; the notebook " +
          "may be mixing server-mode cells (`query.source`) with a fixture-mode " +
          "notebook header. Set `query.fixture: { kind: ... }` on each cell.",
      );
    }
    const { columns, rows } = runFixtureQuery(input.fixtureQuery, this.fixture);
    return {
      query_name: input.queryName ?? input.cellId ?? "fixture",
      target: "fixture",
      row_count: rows.length,
      columns,
      rows,
    };
  }

  async mutate(
    command: MutationCommand,
    _context: MutationContext,
  ): Promise<MutationResult> {
    const params = command.params;
    switch (params.kind) {
      case "set_field": {
        const node = this.fixture.nodes.find((n) => n.id === params.target_id);
        if (!node) {
          throw new Error(
            `mutate set_field: no node with id '${params.target_id}'`,
          );
        }
        if (node.type !== params.target_type) {
          throw new Error(
            `mutate set_field: type mismatch — expected ${params.target_type}, found ${node.type} for id '${params.target_id}'`,
          );
        }
        // In-place mutation; the App's epoch bump after this call triggers
        // a re-execution that re-reads the (now-updated) fixture.
        node[params.field] = params.value;
        return { kind: "ok" };
      }
    }
  }
}
