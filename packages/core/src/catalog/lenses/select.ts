import { z } from "zod";

/**
 * Query-backed author shape — parsed ONLY on the data path (a Select cell
 * with a `query`), so `value_column` is required and static `options` isn't
 * part of the shape at all. `value` stays unknown so the `{ $bindState }`
 * marker survives the assemble-time parse (the renderer resolves it).
 */
export const SelectAuthorPropsSchema = z.object({
  label: z.string().optional(),
  placeholder: z.string().optional(),
  /** Result column whose value is written to state when a row is picked. */
  value_column: z.string().min(1),
  /** Display column; defaults to `value_column`. */
  label_column: z.string().min(1).optional(),
  value: z.unknown().optional(),
});
export type SelectAuthorProps = z.infer<typeof SelectAuthorPropsSchema>;

/**
 * Registered runtime schema — validates the RESOLVED props of BOTH shapes:
 * static options (control path) and query-backed rows (data path).
 */
export const SelectRuntimePropsSchema = z
  .object({
    label: z.string().optional(),
    placeholder: z.string().optional(),
    /** Static options (query-less Select). */
    options: z.array(z.string()).min(1).optional(),
    /** Query-backed picker: rows + the column mapping. */
    value_column: z.string().min(1).optional(),
    label_column: z.string().min(1).optional(),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    /** When two-way bound via $bindState, this is read & written by the framework. */
    value: z.string().optional(),
  })
  .refine(
    (p) => (p.options !== undefined) !== (p.value_column !== undefined),
    "Select requires exactly one of `options` (static) or `value_column` (query-backed)",
  );
export type SelectRuntimeProps = z.infer<typeof SelectRuntimePropsSchema>;

export const SelectDescription =
  "Single selection. Static: `options` renders a dropdown/cycler. Query-backed entity picker: give the CELL a `query` plus `value_column` (state value) / `label_column` (display) — result rows become the options, rendered as a searchable typeahead. Two-way bind `value` to a state path via $bindState.";
