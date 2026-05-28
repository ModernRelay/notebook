import type { VisibilityCondition } from "@json-render/core";
import type {
  Cell,
  ControlKind,
  FixtureQuery,
  LensKind,
  MutationParams,
  MutationResult,
  Notebook,
} from "@omnigraph/notebook-spec";
import {
  assembleControlSpec,
  assembleLensSpec,
  type LensSpec,
  type QueryResult,
} from "@omnigraph/catalog";

/** Input shape for any cell-execution source. */
export interface ReadInput {
  query_source?: string;
  query_name?: string;
  params?: Record<string, unknown>;
  branch?: string;
  snapshot?: string;
  /** Set in fixture mode; HTTP client ignores. */
  fixture_query?: FixtureQuery;
  /** Originating cell id; useful for source-side logging. */
  cell_id?: string;
}

export interface ReadOutput {
  query_name: string;
  target: string;
  row_count: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface Source {
  read(input: ReadInput): Promise<ReadOutput>;
  /**
   * Apply one atomic mutation. Optional — when absent, ActionList
   * `mutation` actions surface a clear error rather than failing silently.
   */
  mutate?(params: MutationParams): Promise<MutationResult>;
}

// ── Mutation context ─────────────────────────────────────────────────────
//
// Action handlers registered at module load can't capture the App-level
// Source. Use a singleton; the App calls `setMutationSource(source)` before
// rendering, the registered `mutate` handler reads it via getMutationSource.
// Single-app per process; if we ever embed multiple notebooks in one process
// this becomes a Map keyed by notebook id.

let _mutationSource: Source | undefined;

export function setMutationSource(source: Source): void {
  _mutationSource = source;
}

export function getMutationSource(): Source {
  if (!_mutationSource) {
    throw new Error(
      "no mutation source registered — call setMutationSource(source) before render",
    );
  }
  return _mutationSource;
}

export interface CellExecution {
  cell: Cell;
  result: QueryResult | null;
  spec: LensSpec | null;
  /**
   * Inline control specs (filter Selects, Toggles, action Buttons)
   * attached to this cell via `cell.controls`. Rendered above the main
   * lens output. Each spec is a single json-render element; the renderer
   * dispatches them via the same registry as the main lens.
   */
  controlSpecs: LensSpec[];
  durationMs: number;
  error: { message: string; cause?: string } | null;
}

export interface NotebookExecution {
  notebook: Notebook;
  cells: CellExecution[];
  startedAt: number;
  finishedAt: number;
}

export interface RunOptions {
  /**
   * Current state model snapshot. Used to resolve `{ $state: "/path" }`
   * expressions inside `query.fixture.where` and `query.params` before
   * each cell's read. Defaults to `{}` (no expressions resolved → empty
   * state lookups → keys with empty/null values are dropped from `where`).
   */
  state?: Record<string, unknown>;
}

const CONTROL_KINDS: readonly ControlKind[] = ["Button", "Toggle", "Select"];

function isControl(cell: Cell): boolean {
  return (CONTROL_KINDS as readonly string[]).includes(cell.lens);
}

/**
 * Run a notebook's cells sequentially. Each cell's failure is captured on
 * the cell record but does not abort the whole notebook. Control cells
 * (Button/Toggle/Select) skip query execution and pass their props through
 * directly into the spec for json-render to render. Data cells resolve
 * `$state` expressions in their query against `options.state` first.
 */
export async function runNotebook(
  notebook: Notebook,
  source: Source,
  options: RunOptions = {},
): Promise<NotebookExecution> {
  const startedAt = Date.now();
  const state = options.state ?? {};
  const cells: CellExecution[] = [];
  for (const cell of notebook.cells) {
    cells.push(await runCell(cell, source, state));
  }
  return { notebook, cells, startedAt, finishedAt: Date.now() };
}

function buildControlSpecs(cell: Cell): LensSpec[] {
  if (!cell.controls || cell.controls.length === 0) return [];
  return cell.controls.map((ctl, idx) => {
    const ctlId = ctl.id ?? `${cell.id}__ctl_${idx}`;
    return assembleControlSpec(ctlId, ctl.lens, ctl.props, {
      on: ctl.on,
      visible: ctl.visible as VisibilityCondition | undefined,
    });
  });
}

async function runCell(
  cell: Cell,
  source: Source,
  state: Record<string, unknown>,
): Promise<CellExecution> {
  const start = Date.now();
  const controlSpecs = buildControlSpecs(cell);

  if (isControl(cell)) {
    // Control cell: no query, no source.read. Spec is built from the raw
    // props plus on/visible. json-render resolves $state/$bindState/$cond
    // at render time.
    const spec = assembleControlSpec(cell.id, cell.lens, cell.props, {
      on: cell.on,
      visible: cell.visible as VisibilityCondition | undefined,
    });
    return {
      cell,
      result: null,
      spec,
      controlSpecs,
      durationMs: Date.now() - start,
      error: null,
    };
  }

  // Data cell.
  if (!cell.query) {
    return {
      cell,
      result: null,
      spec: null,
      controlSpecs,
      durationMs: Date.now() - start,
      error: { message: "data cell has no query (notebook-spec invariant violated)" },
    };
  }

  try {
    const input: ReadInput = { cell_id: cell.id };
    if (cell.query.source !== undefined) input.query_source = cell.query.source;
    if (cell.query.name !== undefined) input.query_name = cell.query.name;
    if (cell.query.params !== undefined) {
      input.params = resolveParams(cell.query.params, state);
    }
    if (cell.query.branch !== undefined) input.branch = cell.query.branch;
    if (cell.query.snapshot !== undefined) input.snapshot = cell.query.snapshot;
    if (cell.query.fixture !== undefined) {
      input.fixture_query = resolveFixtureQuery(cell.query.fixture, state);
    }

    const raw: ReadOutput = await source.read(input);
    const result: QueryResult = raw;
    // Safe cast: isControl(cell) was false, so cell.lens is a data lens.
    const spec = assembleLensSpec(
      cell.id,
      cell.lens as LensKind,
      cell.props,
      result,
      { on: cell.on, visible: cell.visible as VisibilityCondition | undefined },
    );
    return { cell, result, spec, controlSpecs, durationMs: Date.now() - start, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      cell,
      result: null,
      spec: null,
      controlSpecs,
      durationMs: Date.now() - start,
      error: { message },
    };
  }
}

// ── $state resolution ────────────────────────────────────────────────────

function resolveParams(
  params: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = resolveExpr(v, state);
  }
  return out;
}

/**
 * Walk a fixture query and resolve `{ $state: "/path" }` expressions
 * inside `where` maps (top-level for `nodes` and `ego.center.where`).
 * Drops where-keys whose resolved value is null/undefined/empty-string —
 * the convention is "no filter selected → match anything".
 */
function resolveFixtureQuery(
  q: FixtureQuery,
  state: Record<string, unknown>,
): FixtureQuery {
  switch (q.kind) {
    case "nodes":
      return { ...q, ...(q.where !== undefined && { where: resolveWhere(q.where, state) }) };
    case "ego":
      return {
        ...q,
        center: {
          ...q.center,
          where: resolveWhere(q.center.where, state),
        },
      };
    case "path":
      return q;
  }
}

function resolveWhere(
  where: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(where)) {
    const resolved = resolveExpr(v, state);
    if (resolved === null || resolved === undefined || resolved === "") continue;
    out[k] = resolved;
  }
  return out;
}

/**
 * Resolve a single value:
 *   - `{ $state: "/p" }`                → state lookup
 *   - `{ $state: "/p", default: "x" }`  → state lookup, falling back to
 *     `"x"` when state at `/p` is undefined / null / empty-string
 *
 * The `default` form is the way notebooks seed parameterized .gq queries
 * with a sensible initial value (e.g. an actor slug for a `decisions_by_actor`
 * dashboard) so the cell isn't empty before the user touches the Select.
 * Everything else passes through unchanged.
 */
function resolveExpr(value: unknown, state: Record<string, unknown>): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "$state" in (value as object)
  ) {
    const obj = value as { $state: unknown; default?: unknown };
    if (typeof obj.$state !== "string") return undefined;
    const resolved = resolveStatePointer(state, obj.$state);
    if (resolved === undefined || resolved === null || resolved === "") {
      return obj.default;
    }
    return resolved;
  }
  return value;
}

function resolveStatePointer(
  state: Record<string, unknown>,
  pointer: string,
): unknown {
  if (!pointer.startsWith("/")) return undefined;
  const parts = pointer
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = state;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Immutably set a value at a JSON pointer path in a state object.
 * Returns a fresh object with structural sharing for unaffected branches.
 * Used by the App-level state mirror to apply json-render's `onStateChange`
 * patches before re-executing the notebook.
 */
export function setAtPointer(
  state: Record<string, unknown>,
  pointer: string,
  value: unknown,
): Record<string, unknown> {
  if (!pointer.startsWith("/")) return state;
  const parts = pointer
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.length === 0) return state;

  const root: Record<string, unknown> = { ...state };
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] as string;
    const existing = cur[key];
    const next: Record<string, unknown> =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cur[key] = next;
    cur = next;
  }
  cur[parts[parts.length - 1] as string] = value;
  return root;
}
