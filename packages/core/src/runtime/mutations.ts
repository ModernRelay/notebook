import type { Cell, MutationSpec, Notebook } from "../spec/index.js";
import { MutationSpecSchema } from "../spec/index.js";
import { dataCellIds, isControl } from "./controls.js";
import { formPickerQueries } from "./pickers.js";

export interface OptimisticPatch {
  key: string;
  /** Originating cell — the overlay is view-local to it. */
  cellId: string;
  /** The clicked row's `id_column` value. An overlay key, NOT a graph id. */
  rowKey: string;
  /** A column named in the action's `optimistic.set` (or the removal sentinel). */
  field: string;
  value: unknown;
  /** Row-removal patch (`optimistic.remove`): hide the row while in flight. */
  remove?: boolean;
  saving: boolean;
  error?: string;
  /**
   * Monotonic dispatch token. Two quick mutations on the same `(cellId, rowKey,
   * field)` key share the same map entry; a settle only mutates the entry it
   * still owns (`cur.seq === patch.seq`), so an older settle can't clobber or
   * delete a newer in-flight patch.
   */
  seq: number;
}

/**
 * Every mutation a cell can fire, wherever it's declared: ActionList
 * `props.actions[*].mutation`, Form `props.fields[*].mutation` and its
 * form-level `props.mutations[*]`, a mutation Button's `props.mutation`,
 * and the same shapes inside inline `cell.controls[*].props`.
 */
export function cellMutations(cell: Cell): MutationSpec[] {
  const out: MutationSpec[] = [];
  const collectSpec = (spec: unknown): void => {
    if (!spec || typeof spec !== "object") return;
    const parsed = MutationSpecSchema.safeParse(spec);
    if (parsed.success) out.push(parsed.data);
  };
  const collect = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    collectSpec((candidate as Record<string, unknown>).mutation);
  };
  const collectProps = (props: Record<string, unknown>): void => {
    const actions = Array.isArray(props.actions) ? props.actions : [];
    for (const action of actions) collect(action);
    const fields = Array.isArray(props.fields) ? props.fields : [];
    for (const field of fields) collect(field);
    const formLevel = Array.isArray(props.mutations) ? props.mutations : [];
    for (const spec of formLevel) collectSpec(spec); // Form: props.mutations[*]
    collect(props); // Button: props.mutation
  };
  collectProps(cell.props);
  for (const control of cell.controls ?? []) collectProps(control.props);
  return out;
}

/**
 * Build the optimistic overlay patches for an in-flight mutation from its
 * explicit `optimistic` block — one patch per `set` column, plus a single
 * row-removal patch for `remove: true`, keyed by `(cellId, rowKey, field)`.
 * No `optimistic` block ⇒ no overlay (pending → re-read). Identity here is
 * the row's `id_column` value (`rowKey`), a view-local key — never a graph
 * slug or node type.
 */
export function patchesFromMutation(
  spec: MutationSpec,
  cellId: string,
  rowKey: string,
  seq: number,
): OptimisticPatch[] {
  if (!spec.optimistic) return [];
  const out: OptimisticPatch[] = Object.entries(spec.optimistic.set ?? {}).map(
    ([field, value]) => ({
      key: patchKey(cellId, rowKey, field),
      cellId,
      rowKey,
      field,
      value,
      saving: true,
      seq,
    }),
  );
  if (spec.optimistic.remove === true) {
    out.push({
      key: patchKey(cellId, rowKey, "__remove__"),
      cellId,
      rowKey,
      field: "__remove__",
      value: undefined,
      remove: true,
      saving: true,
      seq,
    });
  }
  return out;
}

export function patchKey(cellId: string, rowKey: string, field: string): string {
  return `${cellId}:${rowKey}:${field}`;
}

/**
 * Which cells a successful dispatch must re-read. Config-declared: each
 * mutation may list the catalog READ-query refs it stales (`invalidates`);
 * matching cells re-read, plus the originating cell. Conservative fallback:
 * if ANY dispatched mutation omits `invalidates`, re-read every data cell
 * (today's behavior — nothing silently goes stale). `invalidates: []` means
 * "only the originating cell".
 */
export function invalidationTargets(
  specs: readonly MutationSpec[],
  notebook: Notebook,
  originCellId?: string,
): Set<string> {
  if (specs.length === 0 || specs.some((s) => s.invalidates === undefined)) {
    return new Set(dataCellIds(notebook));
  }
  const refs = new Set(specs.flatMap((s) => s.invalidates ?? []));
  const out = new Set<string>();
  for (const cell of notebook.cells) {
    if (isControl(cell)) continue;
    const reads =
      (cell.query?.ref !== undefined && refs.has(cell.query.ref)) ||
      formPickerQueries(cell).some((p) => refs.has(p.query.ref));
    if (reads) out.add(cell.id);
  }
  if (originCellId !== undefined) {
    const origin = notebook.cells.find((c) => c.id === originCellId);
    if (origin !== undefined && !isControl(origin)) out.add(originCellId);
  }
  return out;
}
