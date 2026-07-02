import type { VisibilityCondition } from "@json-render/core";
import type {
  Cell,
  LensKind,
  MutationResult,
  MutationSpec,
  Notebook,
} from "../spec/index.js";
import {
  MutationBatchParamsSchema,
  MutationParamsSchema,
} from "../spec/index.js";
import { assembleLensSpec, type QueryResult } from "../catalog/index.js";
import type {
  CellExecution,
  CreateNotebookRuntimeOptions,
  NotebookRuntime,
  ReadOutput,
  ReadRequest,
  RuntimeDispatchContext,
  RuntimeSnapshot,
  RuntimeStateChange,
  RuntimeTarget,
  Source,
} from "./types.js";
import {
  buildControlCellExecution,
  buildControlSpecs,
  emptyCellExecution,
  isControl,
} from "./controls.js";
import {
  dependencyMap,
  pointersOverlap,
  resolveMutationParams,
  resolveParams,
  setAtPointer,
} from "./resolve.js";
import {
  invalidationTargets,
  type OptimisticPatch,
  patchesFromMutation,
} from "./mutations.js";
import { validateNotebookCompatibility } from "./compatibility.js";
import { errorMessage, isAbortError, stringProp } from "./utils.js";

interface CellRun {
  generation: number;
  controller: AbortController;
}

/**
 * Rows the source reports as touched, or null when it can't count (bare
 * `{kind:"ok"}` — no-op detection is skipped for such sources).
 */
function affectedCount(result: MutationResult | undefined | void): number | null {
  const affected = (result as MutationResult | undefined)?.affected;
  return affected === undefined ? null : affected.nodes + affected.edges;
}

export function createNotebookRuntime(
  options: CreateNotebookRuntimeOptions,
): NotebookRuntime {
  return new NotebookRuntimeImpl(options);
}

class NotebookRuntimeImpl implements NotebookRuntime {
  private readonly notebook: Notebook;
  private readonly source: Source;
  private readonly defaultTarget: RuntimeTarget;
  private readonly listeners = new Set<() => void>();
  private readonly rawResults = new Map<string, ReadOutput>();
  private readonly cellRuns = new Map<string, CellRun>();
  private stateDeps = new Map<string, Set<string>>();
  private readonly optimistic = new Map<string, OptimisticPatch>();
  /**
   * Cells with a non-row mutation in flight (a mutation Button, or a Form's
   * batch submit) → dispatch seq + saving flag; a Form batch failure parks
   * its aggregate error here (cell-scoped, cleared by the next dispatch).
   */
  private readonly inflightCells = new Map<
    string,
    { seq: number; saving: boolean; error?: string }
  >();
  /**
   * Persistent per-row no-op warnings, keyed `${cellId}:${rowKey}` (the
   * fields live in the value, so a rowKey containing ':' can't be
   * misparsed). Unlike optimistic patches these survive re-reads —
   * `reconcileOptimisticPatches` never touches them — and clear only when
   * the same row is re-dispatched.
   */
  private readonly rowErrors = new Map<
    string,
    { cellId: string; rowKey: string; seq: number; message: string }
  >();
  private disposed = false;
  private generation = 0;
  private mutationSeq = 0;
  private snapshot: RuntimeSnapshot;

  constructor(options: CreateNotebookRuntimeOptions) {
    this.notebook = options.notebook;
    this.source = options.source;
    this.defaultTarget = options.defaultTarget ?? {};
    const startedAt = Date.now();
    this.snapshot = {
      status: "loading",
      notebook: this.notebook,
      cells: this.notebook.cells.map((cell) => emptyCellExecution(cell)),
      state: options.initialState ?? {},
      generation: 0,
      startedAt,
      finishedAt: null,
      error: null,
      mutationError: null,
      mutationFeedback: null,
      warnings: [],
    };
    this.stateDeps = dependencyMap(this.notebook);

    const compatibility = validateNotebookCompatibility(
      this.notebook,
      this.source.capabilities(),
    );
    if (compatibility.errors.length > 0) {
      this.snapshot = {
        ...this.snapshot,
        status: "fatal",
        error: compatibility.errors.join("\n"),
        warnings: compatibility.warnings,
        finishedAt: Date.now(),
      };
      return;
    }
    this.snapshot = { ...this.snapshot, warnings: compatibility.warnings };
    this.rerunCells(new Set(this.notebook.cells.map((cell) => cell.id)));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): RuntimeSnapshot {
    return this.snapshot;
  }

  applyStateChanges(changes: RuntimeStateChange[]): void {
    if (this.disposed || changes.length === 0) return;
    let next = this.snapshot.state;
    for (const change of changes) {
      next = setAtPointer(next, change.path, change.value);
    }
    const changedPaths = changes.map((change) => change.path);
    this.snapshot = {
      ...this.snapshot,
      state: next,
      mutationError: null,
    };
    this.notify();

    const affected = new Set<string>();
    for (const [cellId, deps] of this.stateDeps) {
      if ([...deps].some((dep) => changedPaths.some((p) => pointersOverlap(dep, p)))) {
        affected.add(cellId);
      }
    }
    if (affected.size > 0) this.rerunCells(affected);
  }

  async dispatch(
    action: string,
    context: RuntimeDispatchContext = {},
  ): Promise<void> {
    if (this.disposed) return;
    if (action === "setState") {
      const statePath = context.params?.statePath;
      if (typeof statePath !== "string") {
        throw new Error("setState requires params.statePath");
      }
      this.applyStateChanges([{ path: statePath, value: context.params?.value }]);
      return;
    }
    if (action === "mutate") {
      await this.dispatchMutation(context);
      return;
    }
    throw new Error(`unknown runtime action '${action}'`);
  }

  dispose(): void {
    this.disposed = true;
    for (const run of this.cellRuns.values()) run.controller.abort();
    this.cellRuns.clear();
    this.listeners.clear();
  }

  private async dispatchMutation(context: RuntimeDispatchContext): Promise<void> {
    if (!this.source.mutate) {
      this.setMutationError("selected source does not support mutations");
      return;
    }

    const raw = { ...(context.params ?? {}) };
    const cellId =
      context.cellId ??
      (typeof raw.__cell_id === "string" ? raw.__cell_id : undefined);
    delete raw.__cell_id;

    // A Form submit dispatches its dirty fields as a batch — same action,
    // second accepted shape.
    if (Array.isArray(raw.mutations)) {
      return this.dispatchMutationBatch(raw, cellId);
    }

    const parsed = MutationParamsSchema.safeParse(raw);
    if (!parsed.success) {
      this.setMutationError(parsed.error.message);
      return;
    }

    const { spec, row, rowKey } = parsed.data;
    const resolvedParams = resolveMutationParams(
      spec.params,
      row,
      this.snapshot.state,
    );
    // Each dispatch gets a monotonic seq so a later dispatch on the same target
    // (Approve→Reject on one row) owns the entry and stale settles no-op.
    const seq = ++this.mutationSeq;
    // A row-button mutation (cellId + rowKey) gets per-field optimistic overlays;
    // a non-row Button mutation (cellId, no rowKey) gets an in-flight saving flag.
    const patches =
      cellId && rowKey ? patchesFromMutation(spec, cellId, rowKey, seq) : [];
    const buttonCell = cellId && !rowKey ? cellId : undefined;
    // Re-dispatching a row clears its parked no-op warning.
    if (cellId && rowKey) this.rowErrors.delete(`${cellId}:${rowKey}`);
    if (patches.length > 0) {
      for (const patch of patches) this.optimistic.set(patch.key, patch);
    }
    if (buttonCell) this.inflightCells.set(buttonCell, { seq, saving: true });
    if (patches.length > 0 || buttonCell || (cellId && rowKey)) {
      this.rebuildSpecsFromRaw();
      this.notify();
    }

    const cell = cellId
      ? this.notebook.cells.find((candidate) => candidate.id === cellId)
      : undefined;
    const readTarget = cell ? this.readTargetForCell(cell) : this.defaultTarget;
    const writeTarget = this.writeTargetForRead(readTarget);
    const controller = new AbortController();

    try {
      const result = await this.source.mutate(
        { params: parsed.data, resolvedParams, cellId },
        {
          cellId,
          readTarget,
          writeTarget,
          state: this.snapshot.state,
          signal: controller.signal,
        },
      );

      const affected = affectedCount(result);
      if (affected === 0) {
        // No-op = failed write: the server matched nothing, so the UI must
        // not pretend otherwise. Roll back the overlay (same as the catch
        // path) and park a persistent warning at the originating cell.
        const label = spec.ref ?? spec.name ?? "mutation";
        const message = `${label} matched no rows — nothing was updated`;
        for (const patch of patches) {
          const cur = this.optimistic.get(patch.key);
          if (cur?.seq === patch.seq) this.optimistic.delete(patch.key);
        }
        if (cellId !== undefined && rowKey !== undefined) {
          this.rowErrors.set(`${cellId}:${rowKey}`, {
            cellId,
            rowKey,
            seq,
            message,
          });
        } else if (buttonCell) {
          if (this.inflightCells.get(buttonCell)?.seq === seq) {
            this.inflightCells.set(buttonCell, {
              seq,
              saving: false,
              error: message,
            });
          }
        } else {
          // Origin unknown (e.g. an inline control) → the global banner.
          this.snapshot = { ...this.snapshot, mutationError: message };
        }
        this.rebuildSpecsFromRaw();
        this.notify();
        return; // no toast, no re-read — nothing changed server-side
      }

      // Only finalize state this dispatch still owns — a newer dispatch on the
      // same target must not be clobbered by our (now-stale) settle.
      for (const patch of patches) {
        const cur = this.optimistic.get(patch.key);
        if (cur?.seq === patch.seq) {
          this.optimistic.set(patch.key, { ...cur, saving: false });
        }
      }
      if (buttonCell && this.inflightCells.get(buttonCell)?.seq === seq) {
        this.inflightCells.delete(buttonCell);
      }
      if (patches.length > 0 || buttonCell) this.rebuildSpecsFromRaw();
      const message =
        affected === null
          ? "Saved"
          : `Saved — ${affected} row${affected === 1 ? "" : "s"}`;
      this.snapshot = {
        ...this.snapshot,
        mutationError: null,
        mutationFeedback: {
          kind: "success",
          message,
          ...(cellId !== undefined ? { cellId } : {}),
          seq,
        },
      };
      this.notify();
      this.rerunCells(invalidationTargets([spec], this.notebook, cellId));
    } catch (err) {
      for (const patch of patches) {
        const cur = this.optimistic.get(patch.key);
        if (cur?.seq === patch.seq) this.optimistic.delete(patch.key);
      }
      if (buttonCell && this.inflightCells.get(buttonCell)?.seq === seq) {
        this.inflightCells.delete(buttonCell);
      }
      const message = errorMessage(err);
      this.snapshot = { ...this.snapshot, mutationError: message };
      this.rebuildSpecsFromRaw();
      this.notify();
    }
  }

  /**
   * A Form's dirty-fields submit: each entry is an independent server commit
   * (there is no server-side batch transaction), dispatched sequentially and
   * stopped at the first error — the honest model. One saving flag for the
   * whole batch, ONE final re-read iff anything committed (saved fields then
   * show fresh data; a failed field's edit stays dirty client-side, so the
   * user re-submits just the remainder).
   */
  private async dispatchMutationBatch(
    raw: Record<string, unknown>,
    cellId: string | undefined,
  ): Promise<void> {
    const parsed = MutationBatchParamsSchema.safeParse(raw);
    if (!parsed.success) {
      this.setMutationError(parsed.error.message);
      return;
    }
    const { mutations, input, row } = parsed.data;
    const seq = ++this.mutationSeq;
    if (cellId) {
      this.inflightCells.set(cellId, { seq, saving: true });
      this.rebuildSpecsFromRaw();
      this.notify();
    }

    const cell = cellId
      ? this.notebook.cells.find((candidate) => candidate.id === cellId)
      : undefined;
    const readTarget = cell ? this.readTargetForCell(cell) : this.defaultTarget;
    const writeTarget = this.writeTargetForRead(readTarget);
    const controller = new AbortController();

    let committed = 0;
    let failure: string | null = null;
    // Total rows across committed entries; null once any entry can't count.
    let affectedTotal: number | null = 0;
    const dispatched: MutationSpec[] = [];
    for (const entry of mutations) {
      dispatched.push(entry.spec);
      const resolvedParams = resolveMutationParams(
        entry.spec.params,
        row,
        this.snapshot.state,
        input,
      );
      const suffix = (): string =>
        mutations.length > 1
          ? ` (${committed}/${mutations.length} fields saved)`
          : "";
      try {
        // `mutate` is guarded non-null by dispatchMutation before we're called.
        const result = await this.source.mutate!(
          { params: { spec: entry.spec }, resolvedParams, cellId },
          {
            cellId,
            readTarget,
            writeTarget,
            state: this.snapshot.state,
            signal: controller.signal,
          },
        );
        const affected = affectedCount(result);
        if (affected === 0) {
          // No-op = failed write: stop the batch like an error; the entry is
          // NOT counted as committed.
          const label = entry.spec.ref ?? entry.spec.name ?? "rawGq";
          failure = `${label}: matched no rows — nothing was updated${suffix()}`;
          break;
        }
        committed += 1;
        affectedTotal =
          affectedTotal === null || affected === null
            ? null
            : affectedTotal + affected;
      } catch (err) {
        const label = entry.spec.ref ?? entry.spec.name ?? "rawGq";
        failure = `${label}: ${errorMessage(err)}${suffix()}`;
        break;
      }
    }

    // Settle only if this dispatch still owns the entry (seq-guarded, same
    // discipline as optimistic patches).
    if (cellId && this.inflightCells.get(cellId)?.seq === seq) {
      if (failure !== null) {
        this.inflightCells.set(cellId, { seq, saving: false, error: failure });
      } else {
        this.inflightCells.delete(cellId);
      }
    }
    if (failure === null && committed > 0) {
      const fields = `${committed} field${committed === 1 ? "" : "s"}`;
      const message =
        affectedTotal === null
          ? `Saved — ${fields}`
          : `Saved — ${fields}, ${affectedTotal} row${affectedTotal === 1 ? "" : "s"}`;
      this.snapshot = {
        ...this.snapshot,
        mutationFeedback: {
          kind: "success",
          message,
          ...(cellId !== undefined ? { cellId } : {}),
          seq,
        },
      };
    }
    this.snapshot = { ...this.snapshot, mutationError: failure };
    this.rebuildSpecsFromRaw();
    this.notify();
    if (committed > 0) {
      this.rerunCells(invalidationTargets(dispatched, this.notebook, cellId));
    }
  }

  private setMutationError(message: string): void {
    this.snapshot = { ...this.snapshot, mutationError: message };
    this.notify();
  }

  private rerunCells(cellIds: Set<string>): void {
    if (this.disposed || cellIds.size === 0) return;
    const generation = ++this.generation;
    const startedAt = Date.now();
    this.snapshot = {
      ...this.snapshot,
      status: this.snapshot.finishedAt === null ? "loading" : "ready",
      generation,
      error: null,
    };
    this.notify();

    const cells = this.notebook.cells.filter((cell) => cellIds.has(cell.id));
    void Promise.all(cells.map((cell) => this.runCell(cell, generation))).then(
      () => {
        if (this.disposed) return;
        this.reconcileOptimisticPatches();
        this.snapshot = {
          ...this.snapshot,
          status: "ready",
          finishedAt: Date.now(),
        };
        if (this.snapshot.startedAt === 0) {
          this.snapshot = { ...this.snapshot, startedAt };
        }
        this.notify();
      },
    );
  }

  private async runCell(cell: Cell, generation: number): Promise<void> {
    const start = Date.now();

    if (isControl(cell)) {
      this.setCellExecution(
        cell.id,
        buildControlCellExecution(
          cell,
          Date.now() - start,
          this.controlRuntimeProps(cell),
        ),
      );
      return;
    }

    if (!cell.query) {
      // A query-less Form is a blank create-form: no read, empty rows. The
      // synthetic result is stored in rawResults so rebuildSpecsFromRaw
      // refreshes its injected runtime props through the normal data path.
      if (cell.lens === "Form") {
        const raw: ReadOutput = {
          query_name: cell.id,
          target: "none",
          row_count: 0,
          columns: [],
          rows: [],
        };
        this.rawResults.set(cell.id, raw);
        this.setCellExecution(
          cell.id,
          this.buildDataCellExecution(cell, raw, Date.now() - start),
        );
        return;
      }
      this.setCellExecution(cell.id, {
        ...emptyCellExecution(cell),
        durationMs: Date.now() - start,
        error: { message: "data cell has no query (notebook-spec invariant violated)" },
      });
      return;
    }

    const controller = new AbortController();
    const previous = this.cellRuns.get(cell.id);
    if (previous) previous.controller.abort();
    this.cellRuns.set(cell.id, { generation, controller });
    // Mark pending while we re-read — the previous spec/result stay visible
    // (stale-while-revalidate); the renderer shows a loading affordance.
    this.markCellPending(cell.id);

    try {
      const request = this.readRequestForCell(cell);
      const readTarget = this.readTargetForCell(cell);
      const raw = await this.source.read(request, {
        cellId: cell.id,
        readTarget,
        state: this.snapshot.state,
        signal: controller.signal,
      });
      if (!this.isCurrentRun(cell.id, generation)) return;
      this.rawResults.set(cell.id, raw);
      this.setCellExecution(
        cell.id,
        this.buildDataCellExecution(cell, raw, Date.now() - start),
      );
    } catch (err) {
      if (!this.isCurrentRun(cell.id, generation) || isAbortError(err)) return;
      // Stale-while-revalidate on failure: keep the last good spec/result
      // visible and attach the error, instead of wiping the cell to an empty
      // error state. rawResults is left intact so the stale view stays coherent.
      // First-load failures have no prior spec, so they fall back to empty.
      const previous = this.snapshot.cells.find(
        (existing) => existing.cell.id === cell.id,
      );
      this.setCellExecution(cell.id, {
        ...(previous ?? emptyCellExecution(cell)),
        pending: false,
        durationMs: Date.now() - start,
        error: { message: errorMessage(err) },
      });
    }
  }

  private isCurrentRun(cellId: string, generation: number): boolean {
    return this.cellRuns.get(cellId)?.generation === generation;
  }

  private setCellExecution(cellId: string, execution: CellExecution): void {
    const cells = this.snapshot.cells.map((existing) =>
      existing.cell.id === cellId ? execution : existing,
    );
    this.snapshot = { ...this.snapshot, cells };
    this.notify();
  }

  /** Flip a cell to pending without disturbing its current spec/result. */
  private markCellPending(cellId: string): void {
    let changed = false;
    const cells = this.snapshot.cells.map((existing) => {
      if (existing.cell.id === cellId && !existing.pending) {
        changed = true;
        return { ...existing, pending: true };
      }
      return existing;
    });
    if (!changed) return;
    this.snapshot = { ...this.snapshot, cells };
    this.notify();
  }

  private rebuildSpecsFromRaw(): void {
    const cells = this.snapshot.cells.map((execution) => {
      if (isControl(execution.cell)) {
        // Rebuild control specs so runtime-injected props (a mutation Button's
        // saving flag) refresh. Bound input values live in state, not the spec,
        // so re-deriving the spec doesn't disturb them.
        return buildControlCellExecution(
          execution.cell,
          execution.durationMs,
          this.controlRuntimeProps(execution.cell),
        );
      }
      const raw = this.rawResults.get(execution.cell.id);
      if (!raw) return execution;
      // Re-derive spec/result (e.g. an optimistic overlay) without disturbing
      // the cell's load lifecycle — `pending` is owned by the read path
      // (markCellPending → runCell), so a mutation-triggered rebuild must not
      // clear an in-flight cell's "updating…" cue.
      return {
        ...this.buildDataCellExecution(
          execution.cell,
          raw,
          execution.durationMs,
        ),
        pending: execution.pending,
      };
    });
    this.snapshot = { ...this.snapshot, cells };
  }

  private buildDataCellExecution(
    cell: Cell,
    raw: ReadOutput,
    durationMs: number,
  ): CellExecution {
    const result = this.applyOptimisticPatches(cell, raw);
    const runtimeProps = this.runtimePropsForCell(cell);
    const spec = assembleLensSpec(
      cell.id,
      cell.lens as LensKind,
      cell.props,
      result,
      {
        on: cell.on,
        visible: cell.visible as VisibilityCondition | undefined,
        ...(runtimeProps !== undefined ? { runtimeProps } : {}),
      },
    );
    return {
      cell,
      result,
      spec,
      controlSpecs: buildControlSpecs(cell),
      durationMs,
      error: null,
      pending: false,
    };
  }

  private applyOptimisticPatches(cell: Cell, raw: ReadOutput): QueryResult {
    if (cell.lens !== "ActionList" || this.optimistic.size === 0) return raw;
    const idColumn = stringProp(cell.props, "id_column");
    if (!idColumn) return raw;

    // Collect this cell's in-flight patches, grouped by rowKey → { field: value }.
    const byRow = new Map<string, Record<string, unknown>>();
    for (const patch of this.optimistic.values()) {
      if (patch.cellId !== cell.id) continue;
      const overlay = byRow.get(patch.rowKey) ?? {};
      overlay[patch.field] = patch.value;
      byRow.set(patch.rowKey, overlay);
    }
    if (byRow.size === 0) return raw;

    let changed = false;
    const rows = raw.rows.map((row) => {
      const id = String(row[idColumn] ?? "");
      const overlay = id ? byRow.get(id) : undefined;
      if (!overlay) return row;
      changed = true;
      return { ...row, ...overlay };
    });

    return changed ? { ...raw, rows } : raw;
  }

  private runtimePropsForCell(
    cell: Cell,
  ): Record<string, unknown> | undefined {
    // A Form gets its cell id + the batch in-flight state (saving flag and
    // any parked aggregate failure from the last submit).
    if (cell.lens === "Form") {
      const inflight = this.inflightCells.get(cell.id);
      return {
        runtime: {
          cell_id: cell.id,
          saving: inflight?.saving === true,
          ...(inflight?.error !== undefined ? { error: inflight.error } : {}),
        },
      };
    }
    if (cell.lens !== "ActionList") return undefined;
    // Per-row mutation state, keyed by the row's id_column value (rowKey).
    const mutationState: Record<string, { saving: boolean; error?: string }> = {};
    for (const patch of this.optimistic.values()) {
      if (patch.cellId !== cell.id) continue;
      const existing = mutationState[patch.rowKey];
      mutationState[patch.rowKey] = {
        saving: (existing?.saving ?? false) || patch.saving,
        ...(patch.error !== undefined
          ? { error: patch.error }
          : existing?.error !== undefined
            ? { error: existing.error }
            : {}),
      };
    }
    // Parked no-op warnings (persist across re-reads, unlike patches).
    for (const entry of this.rowErrors.values()) {
      if (entry.cellId !== cell.id) continue;
      const existing = mutationState[entry.rowKey];
      mutationState[entry.rowKey] = {
        saving: existing?.saving ?? false,
        error: entry.message,
      };
    }

    return {
      runtime: {
        cell_id: cell.id,
        ...(Object.keys(mutationState).length > 0
          ? { mutation_state: mutationState }
          : {}),
      },
    };
  }

  /** Runtime props for a control cell — a mutation `Button` gets its cell id (so
   *  it can dispatch with `__cell_id`) and `saving` (in-flight). Others: none. */
  private controlRuntimeProps(
    cell: Cell,
  ): Record<string, unknown> | undefined {
    if (cell.lens !== "Button") return undefined;
    const inflight = this.inflightCells.get(cell.id);
    return {
      runtime: {
        cell_id: cell.id,
        saving: inflight?.saving === true,
        ...(inflight?.error !== undefined ? { error: inflight.error } : {}),
      },
    };
  }

  private reconcileOptimisticPatches(): void {
    let changed = false;
    for (const [key, patch] of this.optimistic) {
      if (!patch.saving) {
        this.optimistic.delete(key);
        changed = true;
      }
    }
    if (changed) this.rebuildSpecsFromRaw();
  }

  private readRequestForCell(cell: Cell): ReadRequest {
    if (!cell.query) return { cellId: cell.id };
    const target = this.readTargetForCell(cell);
    const request: ReadRequest = { cellId: cell.id };
    if (cell.query.ref !== undefined) request.queryRef = cell.query.ref;
    if (cell.query.rawGq !== undefined) request.querySource = cell.query.rawGq;
    if (cell.query.name !== undefined) request.queryName = cell.query.name;
    if (cell.query.params !== undefined) {
      request.params = resolveParams(cell.query.params, this.snapshot.state);
    }
    if (target.branch !== undefined) request.branch = target.branch;
    if (target.snapshot !== undefined) request.snapshot = target.snapshot;
    return request;
  }

  private readTargetForCell(cell: Cell): RuntimeTarget {
    if (cell.query?.snapshot !== undefined) return { snapshot: cell.query.snapshot };
    if (cell.query?.branch !== undefined) return { branch: cell.query.branch };
    return this.defaultTarget;
  }

  private writeTargetForRead(readTarget: RuntimeTarget): RuntimeTarget {
    if (readTarget.snapshot !== undefined) {
      return this.defaultTarget.branch !== undefined
        ? { branch: this.defaultTarget.branch }
        : {};
    }
    if (readTarget.branch !== undefined) return { branch: readTarget.branch };
    return this.defaultTarget.branch !== undefined
      ? { branch: this.defaultTarget.branch }
      : {};
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
