import type { VisibilityCondition } from "@json-render/core";
import type {
  ActionBinding,
  Cell,
  ControlKind,
  FixtureQuery,
  LensKind,
  MutationParams,
  MutationResult,
  MutationSpec,
  Notebook,
} from "@omnigraph/notebook-spec";
import { MutationParamsSchema } from "@omnigraph/notebook-spec";
import { MutationSpecSchema } from "@omnigraph/notebook-spec";
import {
  assembleControlSpec,
  assembleLensSpec,
  type LensSpec,
  type QueryResult,
} from "@omnigraph/catalog";

export type StructuredQueryKind = FixtureQuery["kind"];
export type MutationKind = MutationSpec["kind"];

export interface SourceCapabilities {
  structuredQueryKinds: readonly StructuredQueryKind[];
  rawGq: boolean;
  mutationKinds: readonly MutationKind[];
  branchReads: boolean;
  snapshotReads: boolean;
  branchWrites: boolean;
}

export interface RuntimeTarget {
  branch?: string;
  snapshot?: string;
}

export interface ReadRequest {
  cellId: string;
  querySource?: string;
  queryName?: string;
  params?: Record<string, unknown>;
  branch?: string;
  snapshot?: string;
  fixtureQuery?: FixtureQuery;
}

export interface ReadOutput {
  query_name: string;
  target: string;
  row_count: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ExecutionContext {
  cellId: string;
  readTarget: RuntimeTarget;
  state: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface MutationCommand {
  params: MutationParams;
  cellId?: string;
}

export interface MutationContext {
  cellId?: string;
  readTarget: RuntimeTarget;
  writeTarget: RuntimeTarget;
  state: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface Source {
  capabilities(): SourceCapabilities;
  read(request: ReadRequest, context: ExecutionContext): Promise<ReadOutput>;
  mutate?(
    command: MutationCommand,
    context: MutationContext,
  ): Promise<MutationResult>;
}

export interface CellExecution {
  cell: Cell;
  result: QueryResult | null;
  spec: LensSpec | null;
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

export type RuntimeStatus = "loading" | "ready" | "fatal";

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  notebook: Notebook;
  cells: CellExecution[];
  state: Record<string, unknown>;
  generation: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  mutationError: string | null;
  warnings: string[];
}

export interface RuntimeStateChange {
  path: string;
  value: unknown;
}

export interface RuntimeDispatchContext {
  params?: Record<string, unknown>;
  cellId?: string;
}

export interface CreateNotebookRuntimeOptions {
  notebook: Notebook;
  source: Source;
  defaultTarget?: RuntimeTarget;
  initialState?: Record<string, unknown>;
}

export interface NotebookRuntime {
  subscribe(listener: () => void): () => void;
  getSnapshot(): RuntimeSnapshot;
  applyStateChanges(changes: RuntimeStateChange[]): void;
  dispatch(action: string, context?: RuntimeDispatchContext): Promise<void>;
  dispose(): void;
}

interface CompatibilityResult {
  errors: string[];
  warnings: string[];
}

interface OptimisticPatch {
  key: string;
  targetType: string;
  targetId: string;
  field: string;
  value: unknown;
  saving: boolean;
  error?: string;
}

interface CellRun {
  generation: number;
  controller: AbortController;
}

const CONTROL_KINDS: readonly ControlKind[] = ["Button", "Toggle", "Select"];

function isControl(cell: Cell): boolean {
  return (CONTROL_KINDS as readonly string[]).includes(cell.lens);
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
      this.rawResults.delete(cell.id);
      this.setCellExecution(cell.id, {
        ...emptyCellExecution(cell),
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

  private rebuildSpecsFromRaw(): void {
    const cells = this.snapshot.cells.map((execution) => {
      const raw = this.rawResults.get(execution.cell.id);
      if (!raw || isControl(execution.cell)) return execution;
      return this.buildDataCellExecution(
        execution.cell,
        raw,
        execution.durationMs,
      );
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

export function validateNotebookCompatibility(
  notebook: Notebook,
  capabilities: SourceCapabilities,
): CompatibilityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const cell of notebook.cells) {
    if (cell.query?.source !== undefined) {
      warnings.push(
        `${cell.id}: query.source raw .gq is deprecated; prefer query.fixture structured DSL`,
      );
      if (!capabilities.rawGq) {
        errors.push(`${cell.id}: selected source does not support raw .gq`);
      }
    }
    if (cell.query?.fixture !== undefined) {
      const kind = cell.query.fixture.kind;
      if (!capabilities.structuredQueryKinds.includes(kind)) {
        errors.push(`${cell.id}: selected source does not support ${kind} queries`);
      }
    }
    if (cell.query?.branch !== undefined && !capabilities.branchReads) {
      errors.push(`${cell.id}: selected source does not support branch reads`);
    }
    if (cell.query?.snapshot !== undefined && !capabilities.snapshotReads) {
      errors.push(`${cell.id}: selected source does not support snapshot reads`);
    }

    for (const mutation of actionListMutations(cell)) {
      if (!capabilities.mutationKinds.includes(mutation.kind)) {
        errors.push(
          `${cell.id}: selected source does not support ${mutation.kind} mutations`,
        );
      }
    }
  }

  return { errors, warnings };
}

function emptyCellExecution(cell: Cell): CellExecution {
  return {
    cell,
    result: null,
    spec: null,
    controlSpecs: buildControlSpecs(cell),
    durationMs: 0,
    error: null,
  };
}

function buildControlCellExecution(
  cell: Cell,
  durationMs: number,
): CellExecution {
  const spec = assembleControlSpec(cell.id, cell.lens, cell.props, {
    on: cell.on,
    visible: cell.visible as VisibilityCondition | undefined,
  });
  return {
    cell,
    result: null,
    spec,
    controlSpecs: buildControlSpecs(cell),
    durationMs,
    error: null,
  };
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

function dependencyMap(notebook: Notebook): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const cell of notebook.cells) {
    if (isControl(cell) || !cell.query) continue;
    const deps = new Set<string>();
    if (cell.query.params !== undefined) collectStatePointers(cell.query.params, deps);
    if (cell.query.fixture !== undefined) collectStatePointers(cell.query.fixture, deps);
    out.set(cell.id, deps);
  }
  return out;
}

function collectStatePointers(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStatePointers(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.$state === "string") out.add(record.$state);
  for (const item of Object.values(record)) collectStatePointers(item, out);
}

function pointersOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function resolveParams(
  params: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = resolveExpr(value, state);
  }
  return out;
}

function resolveFixtureQuery(
  query: FixtureQuery,
  state: Record<string, unknown>,
): FixtureQuery {
  switch (query.kind) {
    case "nodes":
      return {
        ...query,
        ...(query.where !== undefined
          ? { where: resolveWhere(query.where, state) }
          : {}),
      };
    case "ego":
      return {
        ...query,
        center: {
          ...query.center,
          where: resolveWhere(query.center.where, state),
        },
      };
    case "path":
      return query;
  }
}

function resolveWhere(
  where: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    const resolved = resolveExpr(value, state);
    if (resolved === null || resolved === undefined || resolved === "") continue;
    out[key] = resolved;
  }
  return out;
}

function resolveExpr(value: unknown, state: Record<string, unknown>): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "$state" in value
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

function dataCellIds(notebook: Notebook): string[] {
  return notebook.cells.filter((cell) => !isControl(cell)).map((cell) => cell.id);
}

function stringProp(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function actionListMutations(cell: Cell): MutationSpec[] {
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

function actionListMutationTargetTypes(cell: Cell): Set<string> {
  const out = new Set<string>();
  for (const mutation of actionListMutations(cell)) {
    if ("target_type" in mutation) out.add(mutation.target_type);
  }
  return out;
}

function patchFromMutation(params: MutationParams): OptimisticPatch | null {
  switch (params.kind) {
    case "set_field":
      return {
        key: patchKey(params.target_type, params.target_id, params.field),
        targetType: params.target_type,
        targetId: params.target_id,
        field: params.field,
        value: params.value,
        saving: true,
      };
  }
}

function patchKey(targetType: string, targetId: string, field: string): string {
  return `${targetType}:${targetId}:${field}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
