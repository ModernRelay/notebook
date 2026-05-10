import type { FixtureQuery, MutationParams, MutationResult } from "@omnigraph/notebook-spec";
import type { Fixture } from "./validator.js";
import { runFixtureQuery } from "./runner.js";

export interface FixtureReadInput {
  query_source?: string;
  query_name?: string;
  params?: Record<string, unknown>;
  branch?: string;
  snapshot?: string;
  fixture_query?: FixtureQuery;
  cell_id?: string;
}

export interface FixtureReadOutput {
  query_name: string;
  target: string;
  row_count: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * In-memory source. Mutations update the underlying fixture object in
 * place — subsequent `read()` calls see the new state. The current
 * fixture mutates **per-process**: changes do not persist across TUI
 * restarts. (Future: optional writeback to disk.)
 */
export class FixtureSource {
  constructor(private readonly fixture: Fixture) {}

  async read(input: FixtureReadInput): Promise<FixtureReadOutput> {
    if (!input.fixture_query) {
      throw new Error(
        "FixtureSource.read called without `fixture_query`; the notebook " +
          "may be mixing server-mode cells (`query.source`) with a fixture-mode " +
          "notebook header. Set `query.fixture: { kind: ... }` on each cell.",
      );
    }
    const { columns, rows } = runFixtureQuery(input.fixture_query, this.fixture);
    return {
      query_name: input.query_name ?? input.cell_id ?? "fixture",
      target: "fixture",
      row_count: rows.length,
      columns,
      rows,
    };
  }

  async mutate(params: MutationParams): Promise<MutationResult> {
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
