import type {
  Cell,
  MutationParams,
  MutationResult,
  MutationSpec,
  Notebook,
} from "../spec/index.js";
import type { LensSpec, QueryResult } from "../catalog/index.js";

export type MutationKind = MutationSpec["kind"];

export interface SourceCapabilities {
  /** Source can invoke server-owned catalog queries by name (`query.ref`). */
  namedQueries: boolean;
  /** Source accepts raw `.gq` source (`query.rawGq` escape hatch). */
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
  /** Catalog query name (`query.ref`) — invoked server-side by name. */
  queryRef?: string;
  /** Raw `.gq` source (`query.rawGq` escape hatch). */
  querySource?: string;
  /** Selects a query within a multi-query `querySource` payload. */
  queryName?: string;
  params?: Record<string, unknown>;
  branch?: string;
  snapshot?: string;
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
  /**
   * True while a data cell is re-executing (e.g. a filter change or a
   * mutation-triggered re-query) but its previous `spec`/`result` are still
   * being shown (stale-while-revalidate). Renderers use this to show a
   * per-cell loading affordance without clearing the existing content.
   * First load is signalled by `RuntimeSnapshot.status === "loading"` instead.
   */
  pending: boolean;
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
