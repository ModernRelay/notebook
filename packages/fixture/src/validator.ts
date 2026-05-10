import { z } from "zod";

// `.loose()` is the Zod 4 form of `.passthrough()` — keeps extra fields on
// nodes and edges (the call sites use them for typed projections).
export const FixtureNodeSchema = z
  .object({
    type: z.string().min(1),
    id: z.string().min(1),
  })
  .loose();
export type FixtureNode = z.infer<typeof FixtureNodeSchema>;

export const FixtureEdgeSchema = z
  .object({
    type: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .loose();
export type FixtureEdge = z.infer<typeof FixtureEdgeSchema>;

export const FixtureSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  nodes: z.array(FixtureNodeSchema),
  edges: z.array(FixtureEdgeSchema),
});
export type Fixture = z.infer<typeof FixtureSchema>;

/**
 * Validate an already-parsed object as a Fixture. Browser-safe (no fs).
 * Throws if any edge endpoint does not resolve to a known node id, or
 * if any node id is duplicated.
 */
export function parseFixture(raw: unknown, label = "fixture"): Fixture {
  const fixture = FixtureSchema.parse(raw);

  const ids = new Set<string>();
  const dupes = new Set<string>();
  for (const node of fixture.nodes) {
    if (ids.has(node.id)) dupes.add(node.id);
    ids.add(node.id);
  }
  if (dupes.size > 0) {
    throw new Error(
      `${label}: duplicate node id(s): ${[...dupes].join(", ")}`,
    );
  }

  const orphans: string[] = [];
  for (const edge of fixture.edges) {
    if (!ids.has(edge.from)) orphans.push(`${edge.type} from=${edge.from}`);
    if (!ids.has(edge.to)) orphans.push(`${edge.type} to=${edge.to}`);
  }
  if (orphans.length > 0) {
    throw new Error(
      `${label}: ${orphans.length} edge endpoint(s) reference unknown nodes: ${orphans
        .slice(0, 5)
        .join("; ")}${orphans.length > 5 ? "; …" : ""}`,
    );
  }

  return fixture;
}
