import { describe, it, expect, vi } from "vitest";
import type { Notebook } from "@omnigraph/notebook-spec";
import {
  createNotebookRuntime,
  type ExecutionContext,
  type MutationCommand,
  type MutationContext,
  type ReadOutput,
  type ReadRequest,
  type Source,
  type SourceCapabilities,
  type RuntimeSnapshot,
  validateNotebookCompatibility,
} from "./index.js";

const FULL_CAPS: SourceCapabilities = {
  structuredQueryKinds: ["nodes", "path", "ego"],
  rawGq: true,
  mutationKinds: ["set_field"],
  branchReads: true,
  snapshotReads: true,
  branchWrites: true,
};

function fakeSource(opts: {
  capabilities?: SourceCapabilities;
  read?: (request: ReadRequest, context: ExecutionContext) => Promise<ReadOutput>;
  mutate?: (
    command: MutationCommand,
    context: MutationContext,
  ) => Promise<{ kind: "ok" }>;
}): Source {
  return {
    capabilities: () => opts.capabilities ?? FULL_CAPS,
    read: vi.fn(
      opts.read ??
        (async (request) => ({
          query_name: request.queryName ?? request.cellId,
          target: request.branch ?? request.snapshot ?? "main",
          row_count: 1,
          columns: ["x"],
          rows: [{ x: 1, a: "Andrew", r: "owns", b: "Canon" }],
        })),
    ),
    ...(opts.mutate ? { mutate: vi.fn(opts.mutate) } : {}),
  };
}

async function waitFor(
  runtime: ReturnType<typeof createNotebookRuntime>,
  predicate: (snapshot: RuntimeSnapshot) => boolean,
): Promise<RuntimeSnapshot> {
  const current = runtime.getSnapshot();
  if (predicate(current)) return current;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("timed out waiting for runtime snapshot"));
    }, 1000);
    const unsubscribe = runtime.subscribe(() => {
      const next = runtime.getSnapshot();
      if (predicate(next)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(next);
      }
    });
  });
}

const NOTEBOOK: Notebook = {
  version: 1,
  title: "Test",
  cells: [
    {
      id: "table",
      lens: "Table",
      query: { source: "match (n) return n" },
      props: { columns: [{ key: "x", label: "X" }] },
    },
    {
      id: "path",
      lens: "Path",
      query: { source: "match (a)-[r]->(b) return a, r, b" },
      props: {
        steps: [{ from_column: "a", predicate_column: "r", to_column: "b" }],
      },
    },
  ],
};

describe("validateNotebookCompatibility", () => {
  it("keeps raw .gq accepted but emits a deprecation warning", () => {
    const result = validateNotebookCompatibility(NOTEBOOK, FULL_CAPS);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).toMatch(/deprecated/);
  });

  it("rejects unsupported structured query kinds before execution", () => {
    const nb: Notebook = {
      version: 1,
      title: "x",
      fixture: "./f.json",
      cells: [
        {
          id: "ego",
          lens: "Subgraph",
          query: {
            fixture: {
              kind: "ego",
              center: { type: "Decision", where: {} },
              out: ["owns"],
              in: [],
              project: [{ var: "center.id", as: "id" }],
            },
          },
          props: {
            center: { type: "Decision", id_column: "id", label_column: "id" },
            depth: 1,
          },
        },
      ],
    };
    const result = validateNotebookCompatibility(nb, {
      ...FULL_CAPS,
      structuredQueryKinds: ["nodes", "path"],
    });
    expect(result.errors.join("\n")).toMatch(/ego/);
  });
});

describe("createNotebookRuntime", () => {
  it("runs cells and publishes renderer-ready specs", async () => {
    const runtime = createNotebookRuntime({
      notebook: NOTEBOOK,
      source: fakeSource({}),
    });
    const snapshot = await waitFor(runtime, (s) => s.status === "ready");
    expect(snapshot.cells).toHaveLength(2);
    expect(snapshot.cells[0]?.spec?.elements.table?.type).toBe("Table");
    expect(snapshot.cells[1]?.spec?.elements.path?.type).toBe("Path");
    runtime.dispose();
  });

  it("captures a failed cell read without losing successful cells", async () => {
    const source = fakeSource({
      read: async (request) => {
        if (request.cellId === "path") throw new Error("read failed");
        return {
          query_name: request.cellId,
          target: "main",
          row_count: 1,
          columns: ["x"],
          rows: [{ x: "ok", a: "Andrew", r: "owns", b: "Canon" }],
        };
      },
    });
    const runtime = createNotebookRuntime({ notebook: NOTEBOOK, source });
    const snapshot = await waitFor(runtime, (s) => s.status === "ready");
    expect(snapshot.cells[0]?.error).toBeNull();
    expect(snapshot.cells[0]?.spec?.elements.table?.type).toBe("Table");
    expect(snapshot.cells[1]?.error?.message).toBe("read failed");
    expect(snapshot.cells[1]?.spec).toBeNull();
    runtime.dispose();
  });

  it("keeps the stale spec when a re-read fails (stale-while-revalidate)", async () => {
    const notebook: Notebook = {
      version: 1,
      title: "T",
      cells: [
        {
          id: "t",
          lens: "Table",
          query: {
            fixture: {
              kind: "nodes",
              where: { type: "X", status: { $state: "/f" } },
            },
          },
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    };
    let calls = 0;
    const runtime = createNotebookRuntime({
      notebook,
      source: fakeSource({
        read: async (request) => {
          calls += 1;
          if (calls >= 2) throw new Error("re-read failed");
          return {
            query_name: request.cellId,
            target: "main",
            row_count: 1,
            columns: ["x"],
            rows: [{ x: 1 }],
          };
        },
      }),
    });
    // Initial read succeeds → the cell has a spec.
    const ready = await waitFor(runtime, (s) => s.cells[0]?.spec !== null);
    expect(ready.cells[0]?.error).toBeNull();

    // A filter change triggers a re-read that fails.
    runtime.applyStateChanges([{ path: "/f", value: "open" }]);
    const errored = await waitFor(runtime, (s) => s.cells[0]?.error !== null);

    // Stale-while-revalidate: prior spec/result stay, error attached, not pending.
    expect(errored.cells[0]?.error?.message).toBe("re-read failed");
    expect(errored.cells[0]?.spec).not.toBeNull();
    expect(errored.cells[0]?.result).not.toBeNull();
    expect(errored.cells[0]?.pending).toBe(false);
    runtime.dispose();
  });

  it("stops before reads when compatibility validation fails", () => {
    const read = vi.fn(async () => ({
      query_name: "q",
      target: "main",
      row_count: 0,
      columns: [],
      rows: [],
    }));
    const runtime = createNotebookRuntime({
      notebook: NOTEBOOK,
      source: fakeSource({
        capabilities: { ...FULL_CAPS, rawGq: false },
        read,
      }),
    });
    const snapshot = runtime.getSnapshot();
    expect(snapshot.status).toBe("fatal");
    expect(snapshot.error).toMatch(/raw \.gq/);
    expect(read).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("reruns only cells whose $state dependencies changed", async () => {
    const calls: string[] = [];
    const source = fakeSource({
      read: async (request) => {
        calls.push(request.cellId);
        return {
          query_name: request.cellId,
          target: "fixture",
          row_count: 0,
          columns: [],
          rows: [],
        };
      },
    });
    const nb: Notebook = {
      version: 1,
      title: "x",
      fixture: "./f.json",
      cells: [
        {
          id: "filtered",
          lens: "Table",
          query: {
            fixture: {
              kind: "nodes",
              where: {
                type: "Decision",
                status: { $state: "/filters/status" },
              },
            },
          },
          props: { columns: [{ key: "id", label: "ID" }] },
        },
        {
          id: "static",
          lens: "Table",
          query: { fixture: { kind: "nodes", where: { type: "Issue" } } },
          props: { columns: [{ key: "id", label: "ID" }] },
        },
      ],
    };

    const runtime = createNotebookRuntime({ notebook: nb, source });
    await waitFor(runtime, (s) => s.status === "ready");
    calls.length = 0;
    runtime.applyStateChanges([{ path: "/filters/status", value: "open" }]);
    await waitFor(runtime, (s) => s.generation >= 2 && s.status === "ready");
    expect(calls).toEqual(["filtered"]);
    runtime.dispose();
  });

  it("coalesces multiple state changes in one patch into one affected-cell rerun", async () => {
    const calls: string[] = [];
    const source = fakeSource({
      read: async (request) => {
        calls.push(request.cellId);
        return {
          query_name: request.cellId,
          target: "fixture",
          row_count: 0,
          columns: [],
          rows: [],
        };
      },
    });
    const nb: Notebook = {
      version: 1,
      title: "x",
      fixture: "./f.json",
      cells: [
        {
          id: "filtered",
          lens: "Table",
          query: {
            fixture: {
              kind: "nodes",
              where: {
                type: "Decision",
                status: { $state: "/filters/status" },
                urgency: { $state: "/filters/urgency" },
              },
            },
          },
          props: { columns: [{ key: "id", label: "ID" }] },
        },
      ],
    };

    const runtime = createNotebookRuntime({ notebook: nb, source });
    await waitFor(runtime, (s) => s.status === "ready");
    calls.length = 0;
    runtime.applyStateChanges([
      { path: "/filters/status", value: "open" },
      { path: "/filters/urgency", value: "high" },
    ]);
    await waitFor(runtime, (s) => s.generation >= 2 && s.status === "ready");
    expect(calls).toEqual(["filtered"]);
    runtime.dispose();
  });

  it("discards stale read results by generation", async () => {
    let resolveFirst: ((out: ReadOutput) => void) | undefined;
    let resolveSecond: ((out: ReadOutput) => void) | undefined;
    let count = 0;
    const source = fakeSource({
      read: (request) => {
        count += 1;
        return new Promise<ReadOutput>((resolve) => {
          if (count === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        }).then((out) => ({ ...out, query_name: request.cellId }));
      },
    });
    const nb: Notebook = {
      version: 1,
      title: "x",
      fixture: "./f.json",
      cells: [
        {
          id: "filtered",
          lens: "Table",
          query: {
            fixture: {
              kind: "nodes",
              where: { type: "Decision", status: { $state: "/f" } },
            },
          },
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    };

    const runtime = createNotebookRuntime({ notebook: nb, source });
    runtime.applyStateChanges([{ path: "/f", value: "new" }]);
    resolveSecond?.({
      query_name: "q",
      target: "fixture",
      row_count: 1,
      columns: ["x"],
      rows: [{ x: "second" }],
    });
    await waitFor(
      runtime,
      (s) => s.cells[0]?.result?.rows[0]?.x === "second",
    );
    resolveFirst?.({
      query_name: "q",
      target: "fixture",
      row_count: 1,
      columns: ["x"],
      rows: [{ x: "first" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.getSnapshot().cells[0]?.result?.rows[0]?.x).toBe("second");
    runtime.dispose();
  });

  it("passes snapshot-originated mutations to the default branch", async () => {
    let seen: MutationContext | null = null;
    const source = fakeSource({
      read: async () => ({
        query_name: "q",
        target: "snapshot",
        row_count: 1,
        columns: ["id", "status", "title"],
        rows: [{ id: "c1", status: "draft", title: "Clause" }],
      }),
      mutate: async (_command, context) => {
        seen = context;
        return { kind: "ok" };
      },
    });
    const nb = actionListNotebook({ snapshot: "snap-1" });
    const runtime = createNotebookRuntime({
      notebook: nb,
      source,
      defaultTarget: { branch: "main" },
    });
    await waitFor(runtime, (s) => s.status === "ready");
    await runtime.dispatch("mutate", {
      params: {
        kind: "set_field",
        target_type: "PolicyClause",
        target_id: "c1",
        field: "status",
        value: "approved",
        __cell_id: "review",
      },
    });
    expect(seen?.readTarget).toEqual({ snapshot: "snap-1" });
    expect(seen?.writeTarget).toEqual({ branch: "main" });
    runtime.dispose();
  });

  it("passes branch-originated mutations back to the read branch", async () => {
    let seen: MutationContext | null = null;
    const source = fakeSource({
      read: async () => ({
        query_name: "q",
        target: "review",
        row_count: 1,
        columns: ["id", "status", "title"],
        rows: [{ id: "c1", status: "draft", title: "Clause" }],
      }),
      mutate: async (_command, context) => {
        seen = context;
        return { kind: "ok" };
      },
    });
    const runtime = createNotebookRuntime({
      notebook: actionListNotebook({ branch: "review" }),
      source,
      defaultTarget: { branch: "main" },
    });
    await waitFor(runtime, (s) => s.status === "ready");
    await runtime.dispatch("mutate", {
      params: {
        kind: "set_field",
        target_type: "PolicyClause",
        target_id: "c1",
        field: "status",
        value: "approved",
        __cell_id: "review",
      },
    });
    expect(seen?.readTarget).toEqual({ branch: "review" });
    expect(seen?.writeTarget).toEqual({ branch: "review" });
    runtime.dispose();
  });

  it("passes state snapshot and abort signal to mutation sources", async () => {
    let seen: MutationContext | null = null;
    const source = fakeSource({
      read: async () => ({
        query_name: "q",
        target: "fixture",
        row_count: 1,
        columns: ["id", "status", "title"],
        rows: [{ id: "c1", status: "draft", title: "Clause" }],
      }),
      mutate: async (_command, context) => {
        seen = context;
        return { kind: "ok" };
      },
    });
    const runtime = createNotebookRuntime({
      notebook: actionListNotebook({}),
      source,
      initialState: { actor: "andrew" },
    });
    await waitFor(runtime, (s) => s.status === "ready");
    await runtime.dispatch("mutate", {
      params: {
        kind: "set_field",
        target_type: "PolicyClause",
        target_id: "c1",
        field: "status",
        value: "approved",
        __cell_id: "review",
      },
    });
    expect(seen?.state).toEqual({ actor: "andrew" });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    runtime.dispose();
  });

  it("applies optimistic row overlays while a mutation is in flight", async () => {
    let resolveMutation: (() => void) | undefined;
    const source = fakeSource({
      read: async () => ({
        query_name: "q",
        target: "fixture",
        row_count: 1,
        columns: ["id", "status", "title"],
        rows: [{ id: "c1", status: "draft", title: "Clause" }],
      }),
      mutate: () =>
        new Promise((resolve) => {
          resolveMutation = () => resolve({ kind: "ok" });
        }),
    });
    const runtime = createNotebookRuntime({
      notebook: actionListNotebook({}),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    const mutation = runtime.dispatch("mutate", {
      params: {
        kind: "set_field",
        target_type: "PolicyClause",
        target_id: "c1",
        field: "status",
        value: "approved",
        __cell_id: "review",
      },
    });
    await waitFor(
      runtime,
      (s) => s.cells[0]?.result?.rows[0]?.status === "approved",
    );
    const props = runtime.getSnapshot().cells[0]?.spec?.elements.review
      ?.props as { runtime?: { mutation_state?: Record<string, { saving: boolean }> } };
    expect(props.runtime?.mutation_state?.c1?.saving).toBe(true);
    resolveMutation?.();
    await mutation;
    runtime.dispose();
  });

  it("rolls back optimistic overlays and surfaces mutation errors", async () => {
    const source = fakeSource({
      read: async () => ({
        query_name: "q",
        target: "fixture",
        row_count: 1,
        columns: ["id", "status", "title"],
        rows: [{ id: "c1", status: "draft", title: "Clause" }],
      }),
      mutate: async () => {
        throw new Error("mutation denied");
      },
    });
    const runtime = createNotebookRuntime({
      notebook: actionListNotebook({}),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    await runtime.dispatch("mutate", {
      params: {
        kind: "set_field",
        target_type: "PolicyClause",
        target_id: "c1",
        field: "status",
        value: "approved",
        __cell_id: "review",
      },
    });
    const snapshot = runtime.getSnapshot();
    expect(snapshot.mutationError).toBe("mutation denied");
    expect(snapshot.cells[0]?.result?.rows[0]?.status).toBe("draft");
    const props = snapshot.cells[0]?.spec?.elements.review?.props as {
      runtime?: { mutation_state?: Record<string, { saving: boolean }> };
    };
    expect(props.runtime?.mutation_state?.c1).toBeUndefined();
    runtime.dispose();
  });
});

function actionListNotebook(target: {
  branch?: string;
  snapshot?: string;
}): Notebook {
  return {
    version: 1,
    title: "review",
    fixture: "./f.json",
    cells: [
      {
        id: "review",
        lens: "ActionList",
        query: {
          fixture: { kind: "nodes", where: { type: "PolicyClause" } },
          ...(target.branch !== undefined ? { branch: target.branch } : {}),
          ...(target.snapshot !== undefined ? { snapshot: target.snapshot } : {}),
        },
        props: {
          id_column: "id",
          title_column: "title",
          status_field: "status",
          actions: [
            {
              label: "Approve",
              mutation: {
                kind: "set_field",
                target_type: "PolicyClause",
                field: "status",
                value: "approved",
              },
            },
          ],
        },
      },
    ],
  };
}
