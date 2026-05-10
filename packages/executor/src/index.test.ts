import { describe, it, expect, vi } from "vitest";
import type { Notebook } from "@omnigraph/notebook-spec";
import {
  runNotebook,
  type ReadInput,
  type ReadOutput,
  type Source,
} from "./index.js";

function fakeSource(
  reader: (input: ReadInput) => Promise<ReadOutput>,
): Source {
  return { read: vi.fn(reader) };
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

describe("runNotebook", () => {
  it("runs cells sequentially and returns specs per cell", async () => {
    const source = fakeSource(async (req) => ({
      query_name: req.query_name ?? "anon",
      target: req.branch ?? "main",
      row_count: 1,
      columns: ["x"],
      rows: [{ x: 1, a: "Andrew", r: "owns", b: "Canon" }],
    }));
    const exec = await runNotebook(NOTEBOOK, source);
    expect(exec.cells).toHaveLength(2);
    expect(exec.cells[0]?.spec?.elements["table"]?.type).toBe("Table");
    expect(exec.cells[1]?.spec?.elements["path"]?.type).toBe("Path");
    expect(exec.cells.every((c) => c.error === null)).toBe(true);
  });

  it("captures cell-level failures without aborting the notebook", async () => {
    const source = fakeSource(async (req) => {
      if (req.query_source?.includes("path")) throw new Error("boom");
      return {
        query_name: "q",
        target: "main",
        row_count: 0,
        columns: [],
        rows: [],
      };
    });
    const failing: Notebook = {
      ...NOTEBOOK,
      cells: [
        NOTEBOOK.cells[0]!,
        { ...NOTEBOOK.cells[1]!, query: { source: "MATCH path FAIL" } },
      ],
    };
    const exec = await runNotebook(failing, source);
    expect(exec.cells[0]?.error).toBeNull();
    expect(exec.cells[1]?.error?.message).toBe("boom");
    expect(exec.cells[1]?.spec).toBeNull();
  });

  it("skips query for control cells and emits a passthrough spec", async () => {
    const source = fakeSource(async () => {
      throw new Error("source.read should not be called for control cells");
    });
    const nb: Notebook = {
      version: 1,
      title: "Controls",
      fixture: "./f.json",
      cells: [
        {
          id: "approve",
          lens: "Button",
          props: { label: "Approve" },
          on: { press: { action: "approve", params: { id: "x" } } },
        } as unknown as Notebook["cells"][number],
      ],
    };
    const exec = await runNotebook(nb, source);
    expect(exec.cells[0]?.error).toBeNull();
    expect(exec.cells[0]?.spec?.elements["approve"]?.type).toBe("Button");
    expect(exec.cells[0]?.spec?.elements["approve"]?.on?.press?.action).toBe(
      "approve",
    );
  });

  it("resolves $state in fixture.where against the passed-in state", async () => {
    const seen: ReadInput[] = [];
    const source = fakeSource(async (req) => {
      seen.push(req);
      return {
        query_name: "q",
        target: "fixture",
        row_count: 0,
        columns: [],
        rows: [],
      };
    });
    const nb: Notebook = {
      version: 1,
      title: "x",
      fixture: "./f.json",
      cells: [
        {
          id: "decisions",
          lens: "Table",
          query: {
            fixture: {
              kind: "nodes",
              where: {
                type: "Decision",
                status: { $state: "/filters/decision_status" },
              },
            },
          },
          props: { columns: [{ key: "id", label: "ID" }] },
        } as unknown as Notebook["cells"][number],
      ],
    };
    await runNotebook(nb, source, {
      state: { filters: { decision_status: "proposed" } },
    });
    const fq = seen[0]?.fixture_query;
    if (!fq || fq.kind !== "nodes") throw new Error("unexpected query shape");
    expect(fq.where).toEqual({ type: "Decision", status: "proposed" });
  });

  it("drops where-keys whose $state resolves to null/empty", async () => {
    const seen: ReadInput[] = [];
    const source = fakeSource(async (req) => {
      seen.push(req);
      return {
        query_name: "q",
        target: "fixture",
        row_count: 0,
        columns: [],
        rows: [],
      };
    });
    const nb: Notebook = {
      version: 1,
      title: "x",
      fixture: "./f.json",
      cells: [
        {
          id: "decisions",
          lens: "Table",
          query: {
            fixture: {
              kind: "nodes",
              where: {
                type: "Decision",
                status: { $state: "/filters/decision_status" },
              },
            },
          },
          props: { columns: [{ key: "id", label: "ID" }] },
        } as unknown as Notebook["cells"][number],
      ],
    };
    await runNotebook(nb, source, { state: {} });
    const fq = seen[0]?.fixture_query;
    if (!fq || fq.kind !== "nodes") throw new Error("unexpected query shape");
    expect(fq.where).toEqual({ type: "Decision" });
  });

  it("emits controlSpecs alongside the main spec when cell.controls is set", async () => {
    const source = fakeSource(async () => ({
      query_name: "q",
      target: "fixture",
      row_count: 0,
      columns: [],
      rows: [],
    }));
    const nb: Notebook = {
      version: 1,
      title: "t",
      fixture: "./f.json",
      cells: [
        {
          id: "decisions",
          lens: "Table",
          query: { fixture: { kind: "nodes", where: { type: "Decision" } } },
          props: { columns: [{ key: "id", label: "ID" }] },
          controls: [
            {
              lens: "Select",
              props: {
                label: "Status",
                options: ["", "proposed", "accepted"],
                value: { $bindState: "/filters/status" },
              },
            },
          ],
        } as unknown as Notebook["cells"][number],
      ],
    };
    const exec = await runNotebook(nb, source);
    expect(exec.cells[0]?.controlSpecs).toHaveLength(1);
    expect(exec.cells[0]?.controlSpecs[0]?.elements).toBeDefined();
    const specEl = Object.values(exec.cells[0]!.controlSpecs[0]!.elements)[0];
    expect(specEl?.type).toBe("Select");
  });

  it("forwards fixture_query when present", async () => {
    const calls: ReadInput[] = [];
    const source = fakeSource(async (req) => {
      calls.push(req);
      return {
        query_name: "q",
        target: "fixture",
        row_count: 1,
        columns: ["x"],
        rows: [{ x: 1 }],
      };
    });
    const nb: Notebook = {
      version: 1,
      title: "FixtureMode",
      fixture: "./fixtures/x.json",
      cells: [
        {
          id: "f",
          lens: "Table",
          query: {
            fixture: { kind: "nodes", where: { type: "Decision" } },
          },
          props: { columns: [{ key: "x", label: "X" }] },
        },
      ],
    };
    await runNotebook(nb, source);
    expect(calls[0]?.fixture_query?.kind).toBe("nodes");
    expect(calls[0]?.cell_id).toBe("f");
    expect(calls[0]?.query_source).toBeUndefined();
  });
});
