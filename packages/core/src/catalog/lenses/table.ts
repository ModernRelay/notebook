import { z } from "zod";

export const TableAuthorPropsSchema = z.object({
  columns: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        format: z.enum(["text", "number", "json"]).optional(),
        /** Wrap long prose instead of clipping it to one line. */
        wrap: z.boolean().optional(),
        /** Render a copy-to-clipboard button next to the value (web only). */
        copy: z.boolean().optional(),
        /** Render the value as a subtle badge/chip — for enums (web only). */
        badge: z.boolean().optional(),
        /** Cell text alignment; numeric columns default to "right" (web only). */
        align: z.enum(["left", "right"]).optional(),
      }),
    )
    .min(1),
  dense: z.boolean().optional(),
  /**
   * Make rows clickable: on click, write the row's `select_column` value to
   * this JSON-pointer state path (e.g. "/selected"). Another cell (a Card)
   * can read it via `$state` to show the selected node's detail.
   */
  select_state: z.string().optional(),
  /** Column whose value is written to `select_state` on row click. */
  select_column: z.string().optional(),
});
export type TableAuthorProps = z.infer<typeof TableAuthorPropsSchema>;

export const TableRuntimePropsSchema = TableAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type TableRuntimeProps = z.infer<typeof TableRuntimePropsSchema>;

export const TableDescription =
  "Tabular display of typed rows from a query. Author specifies columns; rows come from the query result.";
