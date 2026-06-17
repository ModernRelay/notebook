import { parseArgs } from "node:util";

import { createNotebookRuntime } from "@omnigraph/runtime";

import { SOURCE_OPTIONS, sourceOptionsFrom } from "../args.js";
import { buildSource, loadNotebook } from "../source.js";
import { waitForSnapshot } from "../wait-for.js";

/**
 * Headless run: execute every cell against its source and emit the resolved
 * results as JSON — the agent equivalent of "screenshot the UI". Fixture mode is
 * fully local; server mode needs a reachable server + graph + token.
 * Exit 0 = ran, 1 = fatal (e.g. an incompatible notebook), 2 = usage.
 */
export async function renderCommand(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...SOURCE_OPTIONS,
      timeout: { type: "string" },
      compact: { type: "boolean" },
    },
  });
  const notebookPath = positionals[0];
  if (!notebookPath) {
    process.stderr.write(
      "usage: render <notebook.yaml> [--server URL --graph ID --token T] [--timeout MS] [--compact]\n",
    );
    return 2;
  }
  const timeoutMs =
    typeof values.timeout === "string" ? Number(values.timeout) : 30_000;

  const loaded = loadNotebook(notebookPath);
  const { source } = buildSource(loaded, sourceOptionsFrom(values));
  const runtime = createNotebookRuntime({ notebook: loaded.notebook, source });
  try {
    const snapshot = await waitForSnapshot(
      runtime,
      (s) => s.status === "ready" || s.status === "fatal",
      timeoutMs,
    );
    const out = {
      status: snapshot.status,
      error: snapshot.error,
      warnings: snapshot.warnings,
      cells: snapshot.cells.map((c) => ({
        id: c.cell.id,
        lens: c.cell.lens,
        error: c.error,
        result: c.result,
      })),
    };
    const indent = values.compact === true ? 0 : 2;
    process.stdout.write(`${JSON.stringify(out, null, indent)}\n`);
    return snapshot.status === "fatal" ? 1 : 0;
  } finally {
    runtime.dispose();
  }
}
