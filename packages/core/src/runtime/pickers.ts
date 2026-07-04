import type { Cell } from "../spec/index.js";

export interface PickerFieldQuery {
  name: string;
  query: { ref: string; params?: Record<string, unknown> };
}

/**
 * A Form cell's picker fields with a well-formed `options_query` — the
 * per-field option reads the runtime performs alongside the cell's main
 * query. Tolerant extractor (mirrors `cellMutations`' philosophy): malformed
 * entries are skipped here — the schema layers report them; the runtime just
 * doesn't read for them.
 */
export function formPickerQueries(cell: Cell): PickerFieldQuery[] {
  if (cell.lens !== "Form") return [];
  const fields = Array.isArray(cell.props.fields) ? cell.props.fields : [];
  const out: PickerFieldQuery[] = [];
  for (const field of fields) {
    if (!field || typeof field !== "object") continue;
    const rec = field as Record<string, unknown>;
    if (rec.kind !== "picker" || typeof rec.name !== "string") continue;
    const q = rec.options_query;
    if (!q || typeof q !== "object") continue;
    const ref = (q as Record<string, unknown>).ref;
    if (typeof ref !== "string" || ref === "") continue;
    const params = (q as Record<string, unknown>).params;
    out.push({
      name: rec.name,
      query: {
        ref,
        ...(params && typeof params === "object" && !Array.isArray(params)
          ? { params: params as Record<string, unknown> }
          : {}),
      },
    });
  }
  return out;
}
