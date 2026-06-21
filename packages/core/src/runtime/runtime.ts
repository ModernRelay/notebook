import type { VisibilityCondition } from "@json-render/core";
import type { Cell, LensKind, Notebook } from "../spec/index.js";
import { MutationParamsSchema } from "../spec/index.js";
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
  dataCellIds,
  emptyCellExecution,
  isControl,
} from "./controls.js";
import {
  dependencyMap,
  pointersOverlap,
  resolveFixtureQuery,
  resolveParams,
  setAtPointer,
} from "./resolve.js";
import {
  actionListMutationTargetTypes,
  type OptimisticPatch,
  patchFromMutation,
  patchKey,
} from "./mutations.js";
import { validateNotebookCompatibility } from "./compatibility.js";
import { errorMessage, isAbortError, stringProp } from "./utils.js";

interface CellRun {
  generation: number;
  controller: AbortController;
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
  private disposed = false;
  private generation = 0;
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

    const parsed = MutationParamsSchema.safeParse(raw);
    if (!parsed.success) {
      this.setMutationError(parsed.error.message);
      return;
    }

    const params = parsed.data;
    const patch = patchFromMutation(params);
    if (patch) {
      this.optimistic.set(patch.key, patch);
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
      await this.source.mutate(
        { params, cellId },
        {
          cellId,
          readTarget,
          writeTarget,
          state: this.snapshot.state,
          signal: controller.signal,
        },
      );
      if (patch) {
        this.optimistic.set(patch.key, { ...patch, saving: false });
        this.rebuildSpecsFromRaw();
      }
      this.snapshot = { ...this.snapshot, mutationError: null };
      this.notify();
      this.rerunCells(new Set(dataCellIds(this.notebook)));
    } catch (err) {
      if (patch) this.optimistic.delete(patch.key);
      const message = errorMessage(err);
      this.snapshot = { ...this.snapshot, mutationError: message };
      this.rebuildSpecsFromRaw();
      this.notify();
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
        buildControlCellExecution(cell, Date.now() - start),
      );
      return;
    }

    if (!cell.query) {
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
      const raw = this.rawResults.get(execution.cell.id);
      if (!raw || isControl(execution.cell)) return execution;
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
    const statusField = stringProp(cell.props, "status_field");
    if (!idColumn || !statusField) return raw;

    const targetTypes = actionListMutationTargetTypes(cell);
    if (targetTypes.size === 0) return raw;

    let changed = false;
    const rows = raw.rows.map((row) => {
      const id = String(row[idColumn] ?? "");
      if (!id) return row;
      for (const targetType of targetTypes) {
        const patch = this.optimistic.get(patchKey(targetType, id, statusField));
        if (patch) {
          changed = true;
          return { ...row, [statusField]: patch.value };
        }
      }
      return row;
    });

    return changed ? { ...raw, rows } : raw;
  }

  private runtimePropsForCell(
    cell: Cell,
  ): Record<string, unknown> | undefined {
    if (cell.lens !== "ActionList") return undefined;
    const idColumn = stringProp(cell.props, "id_column");
    const statusField = stringProp(cell.props, "status_field");
    const raw = this.rawResults.get(cell.id);
    const targetTypes = actionListMutationTargetTypes(cell);
    const mutationState: Record<string, { saving: boolean; error?: string }> = {};

    if (raw && idColumn && statusField) {
      for (const row of raw.rows) {
        const id = String(row[idColumn] ?? "");
        if (!id) continue;
        for (const targetType of targetTypes) {
          const patch = this.optimistic.get(patchKey(targetType, id, statusField));
          if (patch) {
            mutationState[id] = {
              saving: patch.saving,
              ...(patch.error !== undefined ? { error: patch.error } : {}),
            };
          }
        }
      }
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
    if (cell.query.source !== undefined) request.querySource = cell.query.source;
    if (cell.query.name !== undefined) request.queryName = cell.query.name;
    if (cell.query.params !== undefined) {
      request.params = resolveParams(cell.query.params, this.snapshot.state);
    }
    if (target.branch !== undefined) request.branch = target.branch;
    if (target.snapshot !== undefined) request.snapshot = target.snapshot;
    if (cell.query.fixture !== undefined) {
      request.fixtureQuery = resolveFixtureQuery(
        cell.query.fixture,
        this.snapshot.state,
      );
    }
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
