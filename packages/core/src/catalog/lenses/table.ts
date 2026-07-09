import { z } from "zod";
import { evaluateExpr } from "../expr.js";

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
        /**
         * Derived column: an expression evaluated per row at read time, whose
         * result is injected into the row under this column's `key`. For
         * values that decay with time (freshness scores, ages, SLAs) the
         * source stores the durable fact (a date) and the notebook derives
         * the current value on every render — no daily recompute of stored
         * scores. Grammar and builtins (`num`, `days_since`, `tier`):
         * see catalog/expr.ts. Example — current lead rank from a stored
         * post date plus stored component scores:
         *   0.35 * tier(days_since("s.observed_at"),
         *               1,1.0, 3,0.75, 7,0.55, 14,0.35, 30,0.2, 0.05)
         *   + 0.25 * num("eq.summary") + 0.40 * num("ea.summary")
         */
        expr: z.string().min(1).optional(),
        /** Round a derived value to N decimal places (expr columns only). */
        precision: z.number().int().min(0).max(6).optional(),
      }),
    )
    .min(1),
  dense: z.boolean().optional(),
  /**
   * Sort rows before rendering — needed when the display order depends on a
   * derived column the source query cannot order by. Nulls sort last.
   */
  sort: z
    .object({
      key: z.string().min(1),
      dir: z.enum(["asc", "desc"]).optional(),
    })
    .optional(),
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

/**
 * Materialize `expr` columns into the rows and apply the author's `sort`.
 * Runs once per query refresh (in buildRuntimeProps), so web and TUI render
 * identical derived values; renderers stay presentation-only.
 */
export function applyTableDerivations(
  author: TableAuthorProps,
  rows: ReadonlyArray<Record<string, unknown>>,
  nowMs: number,
): Array<Record<string, unknown>> {
  const derived = author.columns.filter((c) => c.expr !== undefined);
  let out: Array<Record<string, unknown>> =
    derived.length === 0
      ? [...rows]
      : rows.map((row) => {
          const extended = { ...row };
          for (const col of derived) {
            const value = evaluateExpr(col.expr!, { row, nowMs });
            extended[col.key] =
              value === null
                ? null
                : col.precision !== undefined
                  ? Number(value.toFixed(col.precision))
                  : value;
          }
          return extended;
        });

  if (author.sort !== undefined) {
    const { key, dir } = author.sort;
    const sign = dir === "desc" ? -1 : 1;
    out = out
      .map((row, index) => ({ row, index })) // stable sort w/ nulls last
      .sort((a, b) => {
        const av = a.row[key];
        const bv = b.row[key];
        const aNull = av === null || av === undefined || av === "";
        const bNull = bv === null || bv === undefined || bv === "";
        if (aNull || bNull) return aNull === bNull ? a.index - b.index : aNull ? 1 : -1;
        const an = Number(av);
        const bn = Number(bv);
        const cmp =
          !Number.isNaN(an) && !Number.isNaN(bn)
            ? an - bn
            : String(av).localeCompare(String(bv));
        return cmp !== 0 ? sign * cmp : a.index - b.index;
      })
      .map((entry) => entry.row);
  }
  return out;
}

export const TableDescription =
  "Tabular display of typed rows from a query. Author specifies columns (including derived expr columns computed at read time); rows come from the query result.";
