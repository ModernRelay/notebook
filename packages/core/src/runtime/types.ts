import type {
  Cell,
  MutationParams,
  MutationResult,
  Notebook,
} from "../spec/index.js";
import type { LensSpec, QueryResult } from "../catalog/index.js";

export interface SourceCapabilities {
  /** Source can invoke server-owned catalog queries/mutations by name (`ref`). */
  namedQueries: boolean;
  /** Source accepts raw `.gq` source (`rawGq` escape hatch — reads and writes). */
  rawGq: boolean;
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
  /** Source-ready param map: `$row`/`$state` already resolved to literals. */
  resolvedParams: Record<string, unknown>;
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

/**
 * The last successful mutation's outcome — the host shell's toast feed.
 * Only success paths ever write it (errors and no-ops go to `mutationError`
 * or per-cell channels), so a toast keyed on `seq` can never announce a
 * failure. Last-write-wins; each distinct `seq` is one dispatch.
 */
export interface MutationFeedback {
  kind: "success";
  /** e.g. "Saved — 1 row" / "Saved — 2 fields, 3 rows" / "Saved". */
  message: string;
  /** Originating cell, when known. */
  cellId?: string;
  seq: number;
}

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
  mutationFeedback: MutationFeedback | null;
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
