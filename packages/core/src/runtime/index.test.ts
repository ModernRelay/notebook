import { describe, it, expect, vi } from "vitest";
import type { Notebook } from "../spec/index.js";
import {
  createNotebookRuntime,
  invalidationTargets,
  notebookStateParams,
  readStatePointer,
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
  namedQueries: true,
  rawGq: true,
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
      query: { ref: "table_q" },
      props: { columns: [{ key: "x", label: "X" }] },
    },
    {
      id: "path",
      lens: "Path",
      query: { ref: "path_q" },
      props: {
        steps: [{ from_column: "a", predicate_column: "r", to_column: "b" }],
      },
    },
  ],
};

describe("notebookStateParams", () => {
  it("collects distinct $state params (first-seen order) with their defaults", () => {
    const notebook: Notebook = {
      version: 1,
      title: "T",
      cells: [
        {
          id: "a",
          lens: "Table",
          query: {
            ref: "q",
            params: { slug: { $state: "/selected", default: "abm" } },
          },
          props: { columns: [{ key: "x", label: "X" }] },
        },
        {
          id: "b",
          lens: "Table",
          query: {
            ref: "q2",
            params: {
              domain: { $state: "/domain", default: "cog" },
              slug: { $state: "/selected", default: "abm" }, // same default → kept
            },
          },
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    };
    expect(notebookStateParams(notebook)).toEqual([
      { pointer: "/selected", default: "abm" },
      { pointer: "/domain", default: "cog" },
    ]);
  });

  it("drops the default when cells declare conflicting defaults for a pointer", () => {
    const notebook: Notebook = {
      version: 1,
      title: "T",
      cells: [
        {
          id: "a",
          lens: "Table",
          query: { ref: "q", params: { s: { $state: "/status", default: "open" } } },
          props: { columns: [{ key: "x", label: "X" }] },
        },
        {
          id: "b",
          lens: "Table",
          query: { ref: "q2", params: { s: { $state: "/status", default: "closed" } } },
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    };
    // No single default to surface → undefined (a host chip shows "—", not a
    // value one cell uses while another queries with the other).
    expect(notebookStateParams(notebook)).toEqual([
      { pointer: "/status", default: undefined },
    ]);
  });

  it("drops the default when one binding omits it (no-default is a distinct value)", () => {
    const notebook: Notebook = {
      version: 1,
      title: "T",
      cells: [
        {
          id: "a",
          lens: "Table",
          query: { ref: "q", params: { s: { $state: "/status", default: "open" } } },
          props: { columns: [{ key: "x", label: "X" }] },
        },
        {
          id: "b",
          lens: "Table",
          query: { ref: "q2", params: { s: { $state: "/status" } } }, // no default
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    };
    // 'a' would query with "open" while 'b' queries with undefined → no agreed
    // default, so the chip surfaces none.
    expect(notebookStateParams(notebook)).toEqual([
      { pointer: "/status", default: undefined },
    ]);
  });

  it("returns [] when no cell binds a $state param", () => {
    const notebook: Notebook = {
      version: 1,
      title: "T",
      cells: [
        {
          id: "a",
          lens: "Table",
          query: { ref: "q" },
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    };
    expect(notebookStateParams(notebook)).toEqual([]);
  });
});

describe("readStatePointer", () => {
  it("reads a value at a pointer, undefined when absent", () => {
    const state = { selected: "abm", filters: { status: "open" } };
    expect(readStatePointer(state, "/selected")).toBe("abm");
    expect(readStatePointer(state, "/filters/status")).toBe("open");
    expect(readStatePointer(state, "/missing")).toBeUndefined();
  });
});

describe("validateNotebookCompatibility", () => {
  const RAWGQ_NB: Notebook = {
    version: 1,
    title: "raw",
    cells: [
      {
        id: "t",
        lens: "Table",
        query: { rawGq: "query q() { match { $d: Decision } return { $d.slug } }" },
        props: { columns: [{ key: "x", label: "X" }] },
      },
    ],
  };

  it("keeps query.rawGq accepted but emits an escape-hatch warning", () => {
    const result = validateNotebookCompatibility(RAWGQ_NB, FULL_CAPS);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).toMatch(/escape hatch/);
  });

  it("rejects query.ref when the source lacks named-query support", () => {
    const result = validateNotebookCompatibility(NOTEBOOK, {
      ...FULL_CAPS,
      namedQueries: false,
    });
    expect(result.errors.join("\n")).toMatch(/named catalog queries/);
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
          query: { ref: "q", params: { status: { $state: "/f" } } },
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
    const rawNb: Notebook = {
      version: 1,
      title: "raw",
      cells: [
        {
          id: "t",
          lens: "Table",
          query: { rawGq: "query q() { match { $d: Decision } return { $d.slug } }" },
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    };
    const runtime = createNotebookRuntime({
      notebook: rawNb,
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
      cells: [
        {
          id: "filtered",
          lens: "Table",
          query: {
            ref: "decisions",
            params: { status: { $state: "/filters/status" } },
          },
          props: { columns: [{ key: "id", label: "ID" }] },
        },
        {
          id: "static",
          lens: "Table",
          query: { ref: "issues" },
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
      cells: [
        {
          id: "filtered",
          lens: "Table",
          query: {
            ref: "decisions",
            params: {
              status: { $state: "/filters/status" },
              urgency: { $state: "/filters/urgency" },
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
      cells: [
        {
          id: "filtered",
          lens: "Table",
          query: { ref: "decisions", params: { status: { $state: "/f" } } },
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
        spec: {
          ref: "approve_clause",
          params: { clause: { $row: "id" } },
          optimistic: { set: { status: "approved" } },
        },
        row: { id: "c1", status: "draft", title: "Clause" },
        rowKey: "c1",
        __cell_id: "review",
      },
    });
    expect(seen?.readTarget).toEqual({ snapshot: "snap-1" });
    expect(seen?.writeTarget).toEqual({ branch: "main" });
    runtime.dispose();
  });

  it("dispatches a non-row Button mutation: resolves $state params, no row, toggles saving", async () => {
    let seen: MutationCommand | null = null;
    let release: (() => void) | undefined;
    const inflight = new Promise<void>((r) => {
      release = r;
    });
    const source = fakeSource({
      read: async () => ({
        query_name: "q",
        target: "t",
        row_count: 0,
        columns: [],
        rows: [],
      }),
      mutate: async (command) => {
        seen = command;
        await inflight;
        return { kind: "ok" };
      },
    });
    const mutation = {
      ref: "set_definition",
      params: { slug: { $state: "/sel" }, definition: { $state: "/newdef" } },
    };
    const notebook: Notebook = {
      version: 1,
      title: "Edit",
      cells: [{ id: "save", lens: "Button", props: { label: "Save", mutation } }],
    };
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    runtime.applyStateChanges([
      { path: "/sel", value: "abm" },
      { path: "/newdef", value: "New def" },
    ]);

    const savingOf = (): unknown => {
      const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "save");
      const el = exec?.spec?.elements?.["save"] as
        | { props?: { runtime?: { saving?: boolean } } }
        | undefined;
      return el?.props?.runtime?.saving;
    };

    const done = runtime.dispatch("mutate", {
      params: { spec: mutation, __cell_id: "save" },
    });
    expect(savingOf()).toBe(true); // in flight
    release?.();
    await done;
    expect(savingOf()).toBe(false); // settled
    const cmd = seen as MutationCommand | null;
    expect(cmd?.resolvedParams).toEqual({ slug: "abm", definition: "New def" });
    expect(cmd?.params.row).toBeUndefined();
    expect(cmd?.params.rowKey).toBeUndefined();
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
        spec: {
          ref: "approve_clause",
          params: { clause: { $row: "id" } },
          optimistic: { set: { status: "approved" } },
        },
        row: { id: "c1", status: "draft", title: "Clause" },
        rowKey: "c1",
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
        spec: {
          ref: "approve_clause",
          params: { clause: { $row: "id" } },
          optimistic: { set: { status: "approved" } },
        },
        row: { id: "c1", status: "draft", title: "Clause" },
        rowKey: "c1",
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
        spec: {
          ref: "approve_clause",
          params: { clause: { $row: "id" } },
          optimistic: { set: { status: "approved" } },
        },
        row: { id: "c1", status: "draft", title: "Clause" },
        rowKey: "c1",
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
        spec: {
          ref: "approve_clause",
          params: { clause: { $row: "id" } },
          optimistic: { set: { status: "approved" } },
        },
        row: { id: "c1", status: "draft", title: "Clause" },
        rowKey: "c1",
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

  it("an older mutation settle never clobbers a newer dispatch on the same key", async () => {
    const resolvers: Array<() => void> = [];
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
          resolvers.push(() => resolve({ kind: "ok" }));
        }),
    });
    const runtime = createNotebookRuntime({
      notebook: actionListNotebook({}),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");

    const dispatchStatus = (value: string) =>
      runtime.dispatch("mutate", {
        params: {
          spec: {
            ref: `set_${value}`,
            params: { clause: { $row: "id" } },
            optimistic: { set: { status: value } },
          },
          row: { id: "c1", status: "draft", title: "Clause" },
          rowKey: "c1",
          __cell_id: "review",
        },
      });

    const approve = dispatchStatus("approved"); // seq 1, in flight
    await waitFor(runtime, (s) => s.cells[0]?.result?.rows[0]?.status === "approved");
    const reject = dispatchStatus("rejected"); // seq 2, owns the key now
    await waitFor(runtime, (s) => s.cells[0]?.result?.rows[0]?.status === "rejected");

    // Resolve the OLDER (approve) settle first — it must NOT flip the row back
    // to approved or clear the newer (reject) saving state.
    resolvers[0]?.();
    await approve;
    const mid = runtime.getSnapshot();
    expect(mid.cells[0]?.result?.rows[0]?.status).toBe("rejected");
    const midProps = mid.cells[0]?.spec?.elements.review?.props as {
      runtime?: { mutation_state?: Record<string, { saving: boolean }> };
    };
    expect(midProps.runtime?.mutation_state?.c1?.saving).toBe(true);

    // Resolve the newer (reject) settle — converges and clears after the
    // post-mutation re-read reconciles (async, hence waitFor).
    resolvers[1]?.();
    await reject;
    await waitFor(runtime, (s) => {
      const pr = s.cells[0]?.spec?.elements.review?.props as {
        runtime?: { mutation_state?: Record<string, { saving: boolean }> };
      };
      return pr.runtime?.mutation_state?.c1 === undefined;
    });
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
    cells: [
      {
        id: "review",
        lens: "ActionList",
        query: {
          ref: "policy_clauses",
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
                ref: "approve_clause",
                params: { clause: { $row: "id" } },
                optimistic: { set: { status: "approved" } },
              },
            },
          ],
        },
      },
    ],
  };
}

// ── Form: batch dispatch + $input ───────────────────────────────────────────

function formNotebook(withQuery: boolean): Notebook {
  const fieldMutation = (ref: string, param: string) => ({
    ref,
    params: { slug: { $state: "/sel" }, [param]: { $input: param } },
  });
  return {
    version: 1,
    title: "Form",
    cells: [
      {
        id: "form",
        lens: "Form",
        ...(withQuery
          ? { query: { ref: "get_task", params: { slug: { $state: "/sel" } } } }
          : {}),
        props: {
          key_column: withQuery ? "slug" : undefined,
          fields: [
            { name: "title", kind: "text", mutation: fieldMutation("set_title", "title") },
            {
              name: "days",
              kind: "number",
              mutation: {
                ref: "set_days",
                params: { slug: { $row: "slug" }, days: { $input: "days" } },
              },
            },
            { name: "priority", kind: "select", options: ["low", "high"], mutation: fieldMutation("set_priority", "priority") },
          ],
        },
      },
      {
        id: "list",
        lens: "Table",
        query: { ref: "all" },
        props: { columns: [{ key: "x", label: "X" }] },
      },
    ],
  } as unknown as Notebook;
}

describe("Form batch dispatch", () => {
  const formRuntimeProps = (
    runtime: ReturnType<typeof createNotebookRuntime>,
  ): { saving?: boolean; error?: string } | undefined => {
    const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "form");
    const el = exec?.spec?.elements?.["form"] as
      | { props?: { runtime?: { saving?: boolean; error?: string } } }
      | undefined;
    return el?.props?.runtime;
  };

  it("dispatches dirty entries sequentially with $input params, one saving flag, ONE final re-read", async () => {
    const seen: MutationCommand[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const source = fakeSource({
      mutate: async (command) => {
        seen.push(command);
        if (seen.length === 1) await gate;
        return { kind: "ok" };
      },
    });
    const notebook = formNotebook(true);
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    runtime.applyStateChanges([{ path: "/sel", value: "t3" }]);
    await waitFor(runtime, (s) => s.status === "ready");
    const readsBefore = (source.read as ReturnType<typeof vi.fn>).mock.calls.length;

    const fields = (notebook.cells[0]!.props as {
      fields: { mutation: unknown }[];
    }).fields;
    const done = runtime.dispatch("mutate", {
      params: {
        mutations: [{ spec: fields[0]!.mutation }, { spec: fields[1]!.mutation }],
        input: { title: "New title", days: 7, priority: "low" },
        row: { slug: "t3-from-row" },
        __cell_id: "form",
      },
    });
    await waitFor(runtime, () => formRuntimeProps(runtime)?.saving === true);
    release?.();
    await done;

    expect(formRuntimeProps(runtime)?.saving).toBe(false);
    expect(formRuntimeProps(runtime)?.error).toBeUndefined();
    expect(seen.map((c) => c.params.spec.ref)).toEqual(["set_title", "set_days"]);
    expect(seen[0]?.resolvedParams).toEqual({ slug: "t3", title: "New title" });
    expect(seen[1]?.resolvedParams).toEqual({ slug: "t3-from-row", days: 7 });
    // ONE re-read wave for the whole batch: both data cells, once each.
    await waitFor(runtime, (s) => s.status === "ready");
    const readsAfter = (source.read as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(readsAfter - readsBefore).toBe(2);
    expect(runtime.getSnapshot().mutationError).toBeNull();
    runtime.dispose();
  });

  it("stops at the first failure, reports (n/m fields saved), still re-reads for the committed part", async () => {
    let calls = 0;
    const source = fakeSource({
      mutate: async () => {
        calls += 1;
        if (calls === 2) throw new Error("boom");
        return { kind: "ok" };
      },
    });
    const notebook = formNotebook(true);
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    const readsBefore = (source.read as ReturnType<typeof vi.fn>).mock.calls.length;

    const fields = (notebook.cells[0]!.props as {
      fields: { mutation: unknown }[];
    }).fields;
    await runtime.dispatch("mutate", {
      params: {
        mutations: fields.map((f) => ({ spec: f.mutation })),
        input: { title: "T", days: 1, priority: "low" },
        __cell_id: "form",
      },
    });

    expect(calls).toBe(2); // third entry never dispatched
    expect(runtime.getSnapshot().mutationError).toMatch(/set_days: boom \(1\/3 fields saved\)/);
    expect(formRuntimeProps(runtime)?.saving).toBe(false);
    expect(formRuntimeProps(runtime)?.error).toMatch(/1\/3 fields saved/);
    // One entry committed → the re-read still runs.
    await waitFor(runtime, (s) => s.status === "ready");
    const readsAfter = (source.read as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(readsAfter - readsBefore).toBe(2);
    runtime.dispose();
  });

  it("skips the re-read entirely when nothing committed", async () => {
    const source = fakeSource({
      mutate: async () => {
        throw new Error("down");
      },
    });
    const notebook = formNotebook(true);
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    const readsBefore = (source.read as ReturnType<typeof vi.fn>).mock.calls.length;

    const fields = (notebook.cells[0]!.props as {
      fields: { mutation: unknown }[];
    }).fields;
    await runtime.dispatch("mutate", {
      params: {
        mutations: [{ spec: fields[0]!.mutation }],
        input: { title: "T" },
        __cell_id: "form",
      },
    });

    expect(runtime.getSnapshot().mutationError).toMatch(/set_title: down/);
    expect(runtime.getSnapshot().mutationError).not.toMatch(/fields saved/);
    const readsAfter = (source.read as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(readsAfter).toBe(readsBefore);
    runtime.dispose();
  });

  it("runs a query-less Form as a blank create-form (no read, empty rows, no error)", async () => {
    const source = fakeSource({});
    const runtime = createNotebookRuntime({
      notebook: formNotebook(false),
      source,
    });
    const snapshot = await waitFor(runtime, (s) => s.status === "ready");
    const exec = snapshot.cells.find((c) => c.cell.id === "form");
    expect(exec?.error).toBeNull();
    const el = exec?.spec?.elements?.["form"] as
      | { props?: { rows?: unknown[] } }
      | undefined;
    expect(el?.props?.rows).toEqual([]);
    // Only the Table cell read; the Form never touched the source.
    const readCells = (source.read as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as ReadRequest).cellId,
    );
    expect(readCells).not.toContain("form");
    runtime.dispose();
  });
});

// ── P3: result feedback, no-op detection, targeted re-read ─────────────────

describe("mutation result feedback + no-op + targeted re-read", () => {
  const okResult = (nodes: number, edges = 0) =>
    ({ kind: "ok", affected: { nodes, edges } }) as const;

  function feedbackNotebook(invalidates?: string[]): Notebook {
    return {
      version: 1,
      title: "P3",
      cells: [
        {
          id: "queue",
          lens: "ActionList",
          query: { ref: "in_review" },
          props: {
            id_column: "id",
            title_column: "title",
            status_field: "status",
            actions: [
              {
                label: "Approve",
                mutation: {
                  ref: "approve",
                  params: { slug: { $row: "id" } },
                  optimistic: { set: { status: "approved" } },
                  ...(invalidates !== undefined ? { invalidates } : {}),
                },
              },
            ],
          },
        },
        {
          id: "list",
          lens: "Table",
          query: { ref: "all_items" },
          props: { columns: [{ key: "x", label: "X" }] },
        },
        {
          id: "other",
          lens: "Table",
          query: { ref: "unrelated" },
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    } as unknown as Notebook;
  }

  const approve = (runtime: ReturnType<typeof createNotebookRuntime>) =>
    runtime.dispatch("mutate", {
      params: {
        spec: {
          ref: "approve",
          params: { slug: { $row: "id" } },
          optimistic: { set: { status: "approved" } },
        },
        row: { id: "r1" },
        rowKey: "r1",
        __cell_id: "queue",
      },
    });

  const rowState = (
    runtime: ReturnType<typeof createNotebookRuntime>,
    rowKey: string,
  ): { saving?: boolean; error?: string } | undefined => {
    const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "queue");
    const el = exec?.spec?.elements?.["queue"] as
      | {
          props?: {
            runtime?: {
              mutation_state?: Record<string, { saving?: boolean; error?: string }>;
            };
          };
        }
      | undefined;
    return el?.props?.runtime?.mutation_state?.[rowKey];
  };

  it("success sets mutationFeedback with rows-affected; 'Saved' when the source can't count", async () => {
    const source = fakeSource({ mutate: async () => okResult(3, 1) });
    const runtime = createNotebookRuntime({
      notebook: feedbackNotebook(),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    await approve(runtime);
    expect(runtime.getSnapshot().mutationFeedback).toMatchObject({
      kind: "success",
      message: "Saved — 4 rows",
      cellId: "queue",
    });

    const uncounted = fakeSource({ mutate: async () => ({ kind: "ok" }) });
    const runtime2 = createNotebookRuntime({
      notebook: feedbackNotebook(),
      source: uncounted,
    });
    await waitFor(runtime2, (s) => s.status === "ready");
    await approve(runtime2);
    expect(runtime2.getSnapshot().mutationFeedback?.message).toBe("Saved");
    runtime.dispose();
    runtime2.dispose();
  });

  it("no-op (0 affected): overlay rolled back, row warning parked, no feedback, no re-read", async () => {
    const source = fakeSource({ mutate: async () => okResult(0) });
    const runtime = createNotebookRuntime({
      notebook: feedbackNotebook(),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    const readsBefore = (source.read as ReturnType<typeof vi.fn>).mock.calls.length;
    await approve(runtime);

    expect(rowState(runtime, "r1")?.error).toMatch(/matched no rows/);
    expect(rowState(runtime, "r1")?.saving).toBe(false);
    expect(runtime.getSnapshot().mutationFeedback).toBeNull();
    expect(runtime.getSnapshot().mutationError).toBeNull();
    const readsAfter = (source.read as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(readsAfter).toBe(readsBefore); // nothing changed server-side
    runtime.dispose();
  });

  it("row no-op warning survives an unrelated re-read and clears on re-dispatch", async () => {
    let affected = 0;
    const source = fakeSource({ mutate: async () => okResult(affected) });
    const runtime = createNotebookRuntime({
      notebook: feedbackNotebook(),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    await approve(runtime);
    expect(rowState(runtime, "r1")?.error).toMatch(/matched no rows/);

    // An unrelated state-driven change doesn't clear the parked warning.
    runtime.applyStateChanges([{ path: "/x", value: 1 }]);
    expect(rowState(runtime, "r1")?.error).toMatch(/matched no rows/);

    // Re-dispatching the same row clears it (and this time it succeeds).
    affected = 1;
    await approve(runtime);
    await waitFor(runtime, (s) => s.status === "ready");
    expect(rowState(runtime, "r1")?.error).toBeUndefined();
    runtime.dispose();
  });

  it("Button no-op parks the warning on the cell's runtime props", async () => {
    const source = fakeSource({ mutate: async () => okResult(0) });
    const notebook: Notebook = {
      version: 1,
      title: "Btn",
      cells: [
        {
          id: "save",
          lens: "Button",
          props: { label: "Go", mutation: { ref: "m", params: {} } },
        },
      ],
    };
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    await runtime.dispatch("mutate", {
      params: { spec: { ref: "m", params: {} }, __cell_id: "save" },
    });
    const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "save");
    const el = exec?.spec?.elements?.["save"] as
      | { props?: { runtime?: { saving?: boolean; error?: string } } }
      | undefined;
    expect(el?.props?.runtime?.error).toMatch(/matched no rows/);
    expect(el?.props?.runtime?.saving).toBe(false);
    runtime.dispose();
  });

  it("no-op with no originating cell falls back to the global mutationError", async () => {
    const source = fakeSource({ mutate: async () => okResult(0) });
    const runtime = createNotebookRuntime({
      notebook: feedbackNotebook(),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    await runtime.dispatch("mutate", {
      params: { spec: { ref: "m", params: {} } },
    });
    expect(runtime.getSnapshot().mutationError).toMatch(/matched no rows/);
    runtime.dispose();
  });

  it("targeted re-read: invalidates=[all_items] re-reads matching cells + origin only", async () => {
    const source = fakeSource({ mutate: async () => okResult(1) });
    const runtime = createNotebookRuntime({
      notebook: feedbackNotebook(["all_items"]),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    const read = source.read as ReturnType<typeof vi.fn>;
    read.mockClear();
    await runtime.dispatch("mutate", {
      params: {
        spec: {
          ref: "approve",
          params: { slug: { $row: "id" } },
          invalidates: ["all_items"],
        },
        row: { id: "r1" },
        rowKey: "r1",
        __cell_id: "queue",
      },
    });
    await waitFor(runtime, (s) => s.status === "ready");
    const cellsRead = read.mock.calls.map((c) => (c[0] as ReadRequest).cellId).sort();
    expect(cellsRead).toEqual(["list", "queue"]); // origin + matching ref; NOT "other"
    runtime.dispose();
  });

  it("targeted re-read: invalidates=[] re-reads the origin only; absent re-reads all", async () => {
    const source = fakeSource({ mutate: async () => okResult(1) });
    const runtime = createNotebookRuntime({
      notebook: feedbackNotebook([]),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    const read = source.read as ReturnType<typeof vi.fn>;
    read.mockClear();
    await runtime.dispatch("mutate", {
      params: {
        spec: { ref: "approve", params: {}, invalidates: [] },
        row: { id: "r1" },
        rowKey: "r1",
        __cell_id: "queue",
      },
    });
    await waitFor(runtime, (s) => s.status === "ready");
    expect(read.mock.calls.map((c) => (c[0] as ReadRequest).cellId)).toEqual(["queue"]);

    read.mockClear();
    await approve(runtime); // spec without invalidates → conservative all
    await waitFor(runtime, (s) => s.status === "ready");
    expect(read.mock.calls.map((c) => (c[0] as ReadRequest).cellId).sort()).toEqual([
      "list",
      "other",
      "queue",
    ]);
    runtime.dispose();
  });

  it("batch: no-op entry stops the batch, reports '(n/m fields saved)', still re-reads the committed part", async () => {
    let call = 0;
    const source = fakeSource({
      mutate: async () => {
        call += 1;
        return call === 2 ? okResult(0) : okResult(1);
      },
    });
    const notebook = formNotebook(true);
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    const read = source.read as ReturnType<typeof vi.fn>;
    read.mockClear();

    const fields = (notebook.cells[0]!.props as { fields: { mutation: unknown }[] }).fields;
    await runtime.dispatch("mutate", {
      params: {
        mutations: fields.map((f) => ({ spec: f.mutation })),
        input: { title: "T", days: 1, priority: "low" },
        row: { slug: "t1" },
        __cell_id: "form",
      },
    });
    expect(call).toBe(2); // third never dispatched
    expect(runtime.getSnapshot().mutationError).toMatch(
      /matched no rows — nothing was updated \(1\/3 fields saved\)/,
    );
    expect(runtime.getSnapshot().mutationFeedback).toBeNull();
    await waitFor(runtime, (s) => s.status === "ready");
    expect(read.mock.calls.length).toBeGreaterThan(0); // committed part re-read
    runtime.dispose();
  });

  it("batch success sets fields+rows feedback and re-reads the invalidates union", async () => {
    const source = fakeSource({ mutate: async () => okResult(1) });
    const notebook = feedbackNotebook();
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    const read = source.read as ReturnType<typeof vi.fn>;
    read.mockClear();
    await runtime.dispatch("mutate", {
      params: {
        mutations: [
          { spec: { ref: "a", params: {}, invalidates: ["all_items"] } },
          { spec: { ref: "b", params: {}, invalidates: ["unrelated"] } },
        ],
        input: {},
        __cell_id: "queue",
      },
    });
    expect(runtime.getSnapshot().mutationFeedback?.message).toBe(
      "Saved — 2 fields, 2 rows",
    );
    await waitFor(runtime, (s) => s.status === "ready");
    expect(read.mock.calls.map((c) => (c[0] as ReadRequest).cellId).sort()).toEqual([
      "list",
      "other",
      "queue",
    ]); // union of both + origin
    runtime.dispose();
  });
});

describe("invalidationTargets", () => {
  const nb = (): Notebook =>
    ({
      version: 1,
      title: "t",
      cells: [
        { id: "a", lens: "Table", query: { ref: "qa" }, props: { columns: [{ key: "x", label: "X" }] } },
        { id: "b", lens: "Table", query: { ref: "qb" }, props: { columns: [{ key: "x", label: "X" }] } },
        { id: "btn", lens: "Button", props: { label: "B" } },
      ],
    }) as unknown as Notebook;

  it("matches cells by ref, adds a data-cell origin, dedupes", () => {
    const t = invalidationTargets(
      [{ ref: "m", invalidates: ["qa", "qa", "bogus"] }],
      nb(),
      "b",
    );
    expect([...t].sort()).toEqual(["a", "b"]);
  });

  it("excludes a control origin", () => {
    const t = invalidationTargets([{ ref: "m", invalidates: [] }], nb(), "btn");
    expect(t.size).toBe(0);
  });

  it("any spec missing invalidates → all data cells", () => {
    const t = invalidationTargets(
      [{ ref: "m", invalidates: ["qa"] }, { ref: "n" }],
      nb(),
    );
    expect([...t].sort()).toEqual(["a", "b"]);
  });
});

describe("batch partial-failure retry (no double-commit)", () => {
  const CREATE_NB: Notebook = {
    version: 1,
    title: "Create",
    cells: [
      {
        id: "form",
        lens: "Form",
        props: {
          fields: [
            { name: "slug", kind: "text" },
            { name: "text", kind: "textarea" },
          ],
          mutations: [
            { ref: "add_comment", params: { slug: { $input: "slug" }, text: { $input: "text" } } },
            { ref: "link_comment", params: { comment: { $input: "slug" }, task: "t1" } },
          ],
        },
      },
    ],
  } as unknown as Notebook;

  const batchParams = (input: Record<string, unknown>) => ({
    mutations: (CREATE_NB.cells[0]!.props as { mutations: unknown[] }).mutations.map(
      (spec) => ({ spec }),
    ),
    input,
    __cell_id: "form",
  });

  it("a committed entry is skipped on retry — even across repeated failures", async () => {
    const calls: string[] = [];
    let linkFailures = 2;
    const source = fakeSource({
      mutate: async (command) => {
        const ref = command.params.spec.ref ?? "?";
        calls.push(ref);
        if (ref === "link_comment" && linkFailures > 0) {
          linkFailures -= 1;
          throw new Error("no task selected");
        }
        return { kind: "ok", affected: { nodes: 1, edges: 0 } };
      },
    });
    const runtime = createNotebookRuntime({ notebook: CREATE_NB, source });
    await waitFor(runtime, (s) => s.status === "ready");

    // Round 1: add commits, link fails → parked with "(1/2 fields saved)".
    await runtime.dispatch("mutate", { params: batchParams({ slug: "c9", text: "hi" }) });
    expect(runtime.getSnapshot().mutationError).toMatch(/link_comment.*\(1\/2 fields saved\)/);

    // Round 2: add is SKIPPED (already committed), link fails again.
    await runtime.dispatch("mutate", { params: batchParams({ slug: "c9", text: "hi" }) });
    // Round 3: add still skipped, link finally succeeds.
    await runtime.dispatch("mutate", { params: batchParams({ slug: "c9", text: "hi" }) });

    expect(calls).toEqual(["add_comment", "link_comment", "link_comment", "link_comment"]);
    expect(runtime.getSnapshot().mutationError).toBeNull();
    expect(runtime.getSnapshot().mutationFeedback?.message).toBe("Saved — 1 field, 1 row");
    runtime.dispose();
  });

  it("edited input re-fires the entry (resolved params differ)", async () => {
    const calls: string[] = [];
    let fail = true;
    const source = fakeSource({
      mutate: async (command) => {
        const ref = command.params.spec.ref ?? "?";
        calls.push(`${ref}:${String(command.resolvedParams.slug ?? command.resolvedParams.comment)}`);
        if (ref === "link_comment" && fail) {
          fail = false;
          throw new Error("boom");
        }
        return { kind: "ok", affected: { nodes: 1, edges: 0 } };
      },
    });
    const runtime = createNotebookRuntime({ notebook: CREATE_NB, source });
    await waitFor(runtime, (s) => s.status === "ready");

    await runtime.dispatch("mutate", { params: batchParams({ slug: "c9", text: "hi" }) });
    // User changes the slug before retrying → add_comment must fire AGAIN
    // (different resolved params = a different write).
    await runtime.dispatch("mutate", { params: batchParams({ slug: "c10", text: "hi" }) });

    expect(calls).toEqual([
      "add_comment:c9",
      "link_comment:c9",
      "add_comment:c10",
      "link_comment:c10",
    ]);
    runtime.dispose();
  });
});

// ── P4: optimistic row removal + create-form success seq ───────────────────

describe("optimistic row removal (delete)", () => {
  const DELETE_NB: Notebook = {
    version: 1,
    title: "Del",
    cells: [
      {
        id: "list",
        lens: "ActionList",
        query: { ref: "items" },
        props: {
          id_column: "id",
          title_column: "title",
          actions: [
            {
              label: "Delete",
              variant: "danger",
              mutation: {
                ref: "del",
                params: { slug: { $row: "id" } },
                confirm: true,
                optimistic: { remove: true },
              },
            },
          ],
        },
      },
    ],
  } as unknown as Notebook;

  const ROWS = [
    { id: "r1", title: "One" },
    { id: "r2", title: "Two" },
  ];

  const listRows = (
    runtime: ReturnType<typeof createNotebookRuntime>,
  ): unknown[] => {
    const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "list");
    const el = exec?.spec?.elements?.["list"] as
      | { props?: { rows?: { id: string }[] } }
      | undefined;
    return (el?.props?.rows ?? []).map((r) => r.id);
  };

  const del = (runtime: ReturnType<typeof createNotebookRuntime>) =>
    runtime.dispatch("mutate", {
      params: {
        spec: {
          ref: "del",
          params: { slug: { $row: "id" } },
          optimistic: { remove: true },
        },
        row: ROWS[0],
        rowKey: "r1",
        __cell_id: "list",
      },
    });

  function gatedSource(opts: { result: () => Promise<{ kind: "ok"; affected?: { nodes: number; edges: number } }> }) {
    let rows = ROWS;
    const source = fakeSource({
      read: async () => ({
        query_name: "items",
        target: "main",
        row_count: rows.length,
        columns: ["id", "title"],
        rows,
      }),
      mutate: async () => opts.result(),
    });
    return {
      source,
      dropRow: () => {
        rows = ROWS.slice(1);
      },
    };
  }

  it("hides the row while in flight; success + re-read keeps it gone", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { source, dropRow } = gatedSource({
      result: async () => {
        await gate;
        return { kind: "ok", affected: { nodes: 1, edges: 0 } };
      },
    });
    const runtime = createNotebookRuntime({ notebook: DELETE_NB, source });
    await waitFor(runtime, (s) => s.status === "ready");
    expect(listRows(runtime)).toEqual(["r1", "r2"]);

    const done = del(runtime);
    expect(listRows(runtime)).toEqual(["r2"]); // hidden immediately
    dropRow(); // fresh server data no longer has r1
    release?.();
    await done;
    await waitFor(runtime, (s) => s.status === "ready");
    expect(listRows(runtime)).toEqual(["r2"]); // gone for real, no flicker
    runtime.dispose();
  });

  it("failure restores the row", async () => {
    const { source } = gatedSource({
      result: async () => {
        throw new Error("boom");
      },
    });
    const runtime = createNotebookRuntime({ notebook: DELETE_NB, source });
    await waitFor(runtime, (s) => s.status === "ready");
    await del(runtime);
    expect(listRows(runtime)).toEqual(["r1", "r2"]); // restored
    expect(runtime.getSnapshot().mutationError).toMatch(/boom/);
    runtime.dispose();
  });

  it("no-op restores the row AND parks the row warning on it", async () => {
    const { source } = gatedSource({
      result: async () => ({ kind: "ok", affected: { nodes: 0, edges: 0 } }),
    });
    const runtime = createNotebookRuntime({ notebook: DELETE_NB, source });
    await waitFor(runtime, (s) => s.status === "ready");
    await del(runtime);
    expect(listRows(runtime)).toEqual(["r1", "r2"]); // restored
    const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "list");
    const el = exec?.spec?.elements?.["list"] as
      | {
          props?: {
            runtime?: { mutation_state?: Record<string, { error?: string }> };
          };
        }
      | undefined;
    expect(el?.props?.runtime?.mutation_state?.["r1"]?.error).toMatch(
      /matched no rows/,
    );
    runtime.dispose();
  });
});

describe("create-form last_success_seq", () => {
  it("is absent before a success and injected after a successful batch", async () => {
    const source = fakeSource({
      mutate: async () => ({ kind: "ok", affected: { nodes: 1, edges: 0 } }),
    });
    const runtime = createNotebookRuntime({
      notebook: formNotebook(false),
      source,
    });
    await waitFor(runtime, (s) => s.status === "ready");
    const seqOf = (): number | undefined => {
      const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "form");
      const el = exec?.spec?.elements?.["form"] as
        | { props?: { runtime?: { last_success_seq?: number } } }
        | undefined;
      return el?.props?.runtime?.last_success_seq;
    };
    expect(seqOf()).toBeUndefined();

    const fields = (formNotebook(false).cells[0]!.props as {
      fields: { mutation: unknown }[];
    }).fields;
    await runtime.dispatch("mutate", {
      params: {
        mutations: [{ spec: fields[0]!.mutation }],
        input: { title: "T" },
        __cell_id: "form",
      },
    });
    await waitFor(runtime, (s) => s.status === "ready");
    const first = seqOf();
    expect(typeof first).toBe("number");

    await runtime.dispatch("mutate", {
      params: {
        mutations: [{ spec: fields[0]!.mutation }],
        input: { title: "U" },
        __cell_id: "form",
      },
    });
    await waitFor(runtime, (s) => s.status === "ready");
    expect(seqOf()).toBeGreaterThan(first!);
    runtime.dispose();
  });
});

// ── Entity picker: dual-mode Select + Form picker option reads ─────────────

describe("query-backed Select (dual-mode classification)", () => {
  const PICKER_NB: Notebook = {
    version: 1,
    title: "Pick",
    cells: [
      {
        id: "rev_pick",
        lens: "Select",
        query: { ref: "all_reviewers", params: { team: { $state: "/team" } } },
        props: { value_column: "slug", label_column: "name", value: { $bindState: "/rev" } },
      },
      {
        id: "static_pick",
        lens: "Select",
        props: { options: ["a", "b"], value: { $bindState: "/x" } },
      },
    ],
  } as unknown as Notebook;

  it("queried Select reads (rows in spec); static Select stays a control (no read)", async () => {
    const source = fakeSource({
      read: async () => ({
        query_name: "all_reviewers",
        target: "main",
        row_count: 2,
        columns: ["slug", "name"],
        rows: [
          { slug: "alice", name: "Alice" },
          { slug: "bob", name: "Bob" },
        ],
      }),
    });
    const runtime = createNotebookRuntime({ notebook: PICKER_NB, source });
    const snapshot = await waitFor(runtime, (s) => s.status === "ready");
    const read = source.read as ReturnType<typeof vi.fn>;
    const readCells = read.mock.calls.map((c) => (c[0] as ReadRequest).cellId);
    expect(readCells).toEqual(["rev_pick"]); // static one never read

    const pickExec = snapshot.cells.find((c) => c.cell.id === "rev_pick");
    const el = pickExec?.spec?.elements?.["rev_pick"] as
      | { props?: { rows?: unknown[] } }
      | undefined;
    expect(el?.props?.rows).toHaveLength(2);

    const staticExec = snapshot.cells.find((c) => c.cell.id === "static_pick");
    expect(staticExec?.result).toBeNull(); // control path
    runtime.dispose();
  });

  it("a $state param in the picker query re-reads on state change", async () => {
    const source = fakeSource({
      read: async () => ({
        query_name: "q", target: "main", row_count: 0, columns: [], rows: [],
      }),
    });
    const runtime = createNotebookRuntime({ notebook: PICKER_NB, source });
    await waitFor(runtime, (s) => s.status === "ready");
    const read = source.read as ReturnType<typeof vi.fn>;
    read.mockClear();
    runtime.applyStateChanges([{ path: "/team", value: "backend" }]);
    await waitFor(runtime, (s) => s.status === "ready");
    expect(read.mock.calls.map((c) => (c[0] as ReadRequest).cellId)).toEqual([
      "rev_pick",
    ]);
    runtime.dispose();
  });

  it("invalidationTargets matches a queried Select by its query.ref", () => {
    const targets = invalidationTargets(
      [{ ref: "m", invalidates: ["all_reviewers"] }],
      PICKER_NB,
    );
    expect([...targets]).toEqual(["rev_pick"]);
  });
});

describe("Form picker option reads", () => {
  const PICKER_FORM_NB: Notebook = {
    version: 1,
    title: "PickerForm",
    cells: [
      {
        id: "form",
        lens: "Form",
        props: {
          fields: [
            { name: "slug", kind: "text" },
            {
              name: "task",
              kind: "picker",
              options_query: { ref: "all_tasks", params: { status: { $state: "/st" } } },
              value_column: "slug",
              label_column: "title",
            },
          ],
          mutations: [
            { ref: "link", params: { task: { $input: "task" } } },
          ],
        },
      },
    ],
  } as unknown as Notebook;

  const TASK_ROWS = [{ slug: "t1", title: "One" }];

  const fieldOptions = (
    runtime: ReturnType<typeof createNotebookRuntime>,
  ): Record<string, unknown[]> | undefined => {
    const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "form");
    const el = exec?.spec?.elements?.["form"] as
      | { props?: { runtime?: { field_options?: Record<string, unknown[]> } } }
      | undefined;
    return el?.props?.runtime?.field_options;
  };

  it("reads the options_query (resolved params) and injects field_options", async () => {
    const source = fakeSource({
      read: async (request) => ({
        query_name: request.queryRef ?? "q",
        target: "main",
        row_count: TASK_ROWS.length,
        columns: ["slug", "title"],
        rows: TASK_ROWS,
      }),
    });
    const runtime = createNotebookRuntime({ notebook: PICKER_FORM_NB, source });
    await waitFor(runtime, (s) => s.status === "ready");

    const read = source.read as ReturnType<typeof vi.fn>;
    // The query-less create-form still issues exactly one read: the options.
    const optionCalls = read.mock.calls.filter(
      (c) => (c[0] as ReadRequest).queryRef === "all_tasks",
    );
    expect(optionCalls).toHaveLength(1);
    expect(fieldOptions(runtime)?.task).toEqual(TASK_ROWS);

    // The form cell itself shows no error and empty prefill rows.
    const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "form");
    expect(exec?.error).toBeNull();
    runtime.dispose();
  });

  it("options-read failure keeps the cell healthy, parks a field error, retains last-good rows", async () => {
    let fail = false;
    const source = fakeSource({
      read: async (request) => {
        if ((request as ReadRequest).queryRef === "all_tasks" && fail) {
          throw new Error("options down");
        }
        return {
          query_name: "all_tasks",
          target: "main",
          row_count: TASK_ROWS.length,
          columns: ["slug", "title"],
          rows: TASK_ROWS,
        };
      },
    });
    const runtime = createNotebookRuntime({ notebook: PICKER_FORM_NB, source });
    await waitFor(runtime, (s) => s.status === "ready");
    expect(fieldOptions(runtime)?.task).toEqual(TASK_ROWS);

    fail = true;
    runtime.applyStateChanges([{ path: "/st", value: "review" }]); // dep re-read
    // Wait for the failed options settle itself (status stays "ready"
    // throughout a background re-read of an already-loaded notebook).
    const errorsOf = (): Record<string, string> | undefined => {
      const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "form");
      const el = exec?.spec?.elements?.["form"] as
        | { props?: { runtime?: { field_options_errors?: Record<string, string> } } }
        | undefined;
      return el?.props?.runtime?.field_options_errors;
    };
    await waitFor(runtime, () => errorsOf()?.task !== undefined);

    const exec = runtime.getSnapshot().cells.find((c) => c.cell.id === "form");
    expect(exec?.error).toBeNull(); // cell stays healthy
    expect(fieldOptions(runtime)?.task).toEqual(TASK_ROWS); // stale rows kept
    expect(errorsOf()?.task).toMatch(/options down/);
    runtime.dispose();
  });

  it("invalidationTargets matches the form by its picker options_query.ref", () => {
    const targets = invalidationTargets(
      [{ ref: "add_task", invalidates: ["all_tasks"] }],
      PICKER_FORM_NB,
    );
    expect([...targets]).toEqual(["form"]);
  });
});

describe("{$now} param marker", () => {
  it("resolves date and datetime forms at dispatch", async () => {
    let seen: Record<string, unknown> | null = null;
    const source = fakeSource({
      mutate: async (command) => {
        seen = command.resolvedParams;
        return { kind: "ok", affected: { nodes: 1, edges: 0 } };
      },
    });
    const notebook: Notebook = {
      version: 1,
      title: "Now",
      cells: [{ id: "b", lens: "Button", props: { label: "Go", mutation: { ref: "m" } } }],
    };
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    await runtime.dispatch("mutate", {
      params: {
        spec: {
          ref: "m",
          params: { at: { $now: "date" }, ts: { $now: "datetime" } },
        },
        __cell_id: "b",
      },
    });
    const params = seen as Record<string, unknown> | null;
    expect(params?.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect((params?.ts as string).startsWith(params?.at as string)).toBe(true);
    runtime.dispose();
  });
});

describe("{$now} offset_days", () => {
  it("shifts the resolved date by the offset", async () => {
    let seen: Record<string, unknown> | null = null;
    const source = fakeSource({
      mutate: async (command) => {
        seen = command.resolvedParams;
        return { kind: "ok", affected: { nodes: 1, edges: 0 } };
      },
    });
    const notebook: Notebook = {
      version: 1,
      title: "Now",
      cells: [{ id: "b", lens: "Button", props: { label: "Go", mutation: { ref: "m" } } }],
    };
    const runtime = createNotebookRuntime({ notebook, source });
    await waitFor(runtime, (s) => s.status === "ready");
    await runtime.dispatch("mutate", {
      params: {
        spec: { ref: "m", params: { before: { $now: "date", offset_days: -60 } } },
        __cell_id: "b",
      },
    });
    const before = (seen as Record<string, unknown> | null)?.before as string;
    expect(before).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const deltaDays =
      (Date.now() - new Date(before).getTime()) / (24 * 60 * 60 * 1000);
    expect(deltaDays).toBeGreaterThan(59);
    expect(deltaDays).toBeLessThan(62);
    runtime.dispose();
  });
});
