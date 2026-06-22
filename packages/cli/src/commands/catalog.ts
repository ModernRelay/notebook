import {
  ActionListAuthorPropsSchema,
  lensActions,
  lensComponents,
  PathAuthorPropsSchema,
  SubgraphAuthorPropsSchema,
  TableAuthorPropsSchema,
} from "@modernrelay/notebook-core";
import type { ZodType } from "zod";
import { z } from "zod";

// Data-lens runtime schemas include `rows` (injected by the executor) — that's
// not a field a notebook author writes. Advertise the AUTHOR schemas for the
// data lenses so agents generate valid YAML; controls have no runtime-only
// fields, so their lensComponents schema is already author-shaped.
const AUTHOR_PROPS: Record<string, ZodType> = {
  Table: TableAuthorPropsSchema,
  Path: PathAuthorPropsSchema,
  Subgraph: SubgraphAuthorPropsSchema,
  ActionList: ActionListAuthorPropsSchema,
};

/**
 * Machine-readable description of the catalog: every lens/control and the prop
 * schema a notebook author writes, every action and its param schema, and how a
 * cell binds a query. Lets an agent discover the authoring surface without
 * reading source.
 */
export function catalogJson(): unknown {
  const lenses: Record<string, unknown> = {};
  for (const [id, def] of Object.entries(lensComponents)) {
    lenses[id] = {
      description: def.description,
      props: z.toJSONSchema(AUTHOR_PROPS[id] ?? def.props, { io: "input" }),
    };
  }
  const actions: Record<string, unknown> = {};
  for (const [id, def] of Object.entries(lensActions)) {
    actions[id] = {
      description: def.description,
      params: z.toJSONSchema(def.params, { io: "input" }),
    };
  }
  return {
    lenses,
    actions,
    query: {
      ref: "Name of a server-owned catalog query (the canonical path).",
      rawGq: "Raw .gq source — a capability-gated escape hatch; prefer `ref`.",
      note: "Exactly one of `ref` or `rawGq` per data cell; both accept `params`/`branch`/`snapshot`.",
    },
  };
}

export function catalogCommand(_argv: string[]): number {
  process.stdout.write(`${JSON.stringify(catalogJson(), null, 2)}\n`);
  return 0;
}
