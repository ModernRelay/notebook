import { z } from "zod";

export const TableAuthorPropsSchema = z.object({
  columns: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        format: z.enum(["text", "number", "json"]).optional(),
      }),
    )
    .min(1),
  dense: z.boolean().optional(),
});
export type TableAuthorProps = z.infer<typeof TableAuthorPropsSchema>;

export const TableRuntimePropsSchema = TableAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type TableRuntimeProps = z.infer<typeof TableRuntimePropsSchema>;

export const TableDescription =
  "Tabular display of typed rows from a query. Author specifies columns; rows come from the query result.";
