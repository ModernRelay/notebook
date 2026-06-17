import { lensActions, lensComponents } from "@omnigraph/catalog";
import { z } from "zod";

/**
 * Machine-readable description of the catalog: every lens/control and its prop
 * schema, every action and its param schema, and the query kinds. Lets an agent
 * discover the authoring surface without reading source.
 */
export function catalogJson(): unknown {
  const lenses: Record<string, unknown> = {};
  for (const [id, def] of Object.entries(lensComponents)) {
    lenses[id] = {
      description: def.description,
      props: z.toJSONSchema(def.props, { io: "input" }),
    };
  }
  const actions: Record<string, unknown> = {};
  for (const [id, def] of Object.entries(lensActions)) {
    actions[id] = {
      description: def.description,
      params: z.toJSONSchema(def.params, { io: "input" }),
    };
  }
  return { lenses, actions, queryKinds: ["nodes", "path", "ego"] };
}

export function catalogCommand(_argv: string[]): number {
  process.stdout.write(`${JSON.stringify(catalogJson(), null, 2)}\n`);
  return 0;
}
