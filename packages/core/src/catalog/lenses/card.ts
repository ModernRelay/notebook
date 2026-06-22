import { z } from "zod";

/**
 * Node-detail card: renders the first row of its result as a labeled
 * field list — "all data for one node". Pair with a single-node query
 * (e.g. `get_concept($slug)`), typically driven by a selection in another
 * cell (a Table's `select_state`, or a Select control).
 */
export const CardAuthorPropsSchema = z.object({
  /** Column used as the card heading (e.g. the node's name/title). */
  title_column: z.string().optional(),
  /**
   * Fields to show, in order. Omit to show every column in the row.
   * `label` defaults to the key.
   */
  fields: z
    .array(z.object({ key: z.string().min(1), label: z.string().optional() }))
    .optional(),
  /** Shown when the query returns no row (e.g. nothing selected yet). */
  empty_text: z.string().optional(),
});
export type CardAuthorProps = z.infer<typeof CardAuthorPropsSchema>;

export const CardRuntimePropsSchema = CardAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type CardRuntimeProps = z.infer<typeof CardRuntimePropsSchema>;

export const CardDescription =
  "Detail card for a single node — renders the first result row as a titled, labeled field list. Drive it with a single-node query (often bound to a selection via $state).";
