import type { Cell, MutationSpec } from "../spec/index.js";
import { MutationSpecSchema } from "../spec/index.js";

export interface OptimisticPatch {
  key: string;
  /** Originating cell — the overlay is view-local to it. */
  cellId: string;
  /** The clicked row's `id_column` value. An overlay key, NOT a graph id. */
  rowKey: string;
  /** A column named in the action's `optimistic.set`. */
  field: string;
  value: unknown;
  saving: boolean;
  error?: string;
}

export function actionListMutations(cell: Cell): MutationSpec[] {
  const actions = Array.isArray(cell.props.actions) ? cell.props.actions : [];
  const out: MutationSpec[] = [];
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const mutation = (action as Record<string, unknown>).mutation;
    if (!mutation || typeof mutation !== "object") continue;
    const parsed = MutationSpecSchema.safeParse(mutation);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Build the optimistic overlay patches for an in-flight mutation from its
 * explicit `optimistic.set` block — one patch per overlaid column, keyed by
 * `(cellId, rowKey, field)`. No `optimistic` block ⇒ no overlay (pending →
 * re-read). Identity here is the row's `id_column` value (`rowKey`), a
 * view-local key — never a graph slug or node type.
 */
export function patchesFromMutation(
  spec: MutationSpec,
  cellId: string,
  rowKey: string,
): OptimisticPatch[] {
  if (!spec.optimistic) return [];
  return Object.entries(spec.optimistic.set).map(([field, value]) => ({
    key: patchKey(cellId, rowKey, field),
    cellId,
    rowKey,
    field,
    value,
    saving: true,
  }));
}

export function patchKey(cellId: string, rowKey: string, field: string): string {
  return `${cellId}:${rowKey}:${field}`;
}
