import { z } from "zod";

export const SubgraphAuthorPropsSchema = z.object({
  center: z.object({
    type: z.string().min(1),
    id_column: z.string().min(1),
    label_column: z.string().min(1),
  }),
  depth: z.union([z.literal(1), z.literal(2)]),
  group_by_predicate: z.boolean().optional(),
});
export type SubgraphAuthorProps = z.infer<typeof SubgraphAuthorPropsSchema>;

export const SubgraphRuntimePropsSchema = SubgraphAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type SubgraphRuntimeProps = z.infer<typeof SubgraphRuntimePropsSchema>;

export const SubgraphDescription =
  "Ego-style rendering of a node and its 1- or 2-hop neighborhood. Author identifies the center type and which columns hold its id and label.";
