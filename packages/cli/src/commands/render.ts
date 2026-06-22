import { watch } from "node:fs";
import { parseArgs } from "node:util";

import { createNotebookRuntime } from "@modernrelay/notebook-core";

import { SOURCE_OPTIONS, sourceOptionsFrom } from "../args.js";
import { buildSource, loadNotebook, type SourceOptions } from "../source.js";
import { waitForSnapshot } from "../wait-for.js";

/**
 * Headless run: execute every cell against omnigraph-server and emit the
 * resolved results as JSON — the agent equivalent of "screenshot the UI".
 * Needs a reachable server + graph (+ token under auth). Exit 0 = ran,
 * 1 = fatal (e.g. an incompatible notebook), 2 = usage.
 *
 * `--watch` re-runs on notebook-file change and holds until Ctrl-C.
 */
export async function renderCommand(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...SOURCE_OPTIONS,
      timeout: { type: "string" },
      compact: { type: "boolean" },
      watch: { type: "boolean" },
    },
  });
  const notebookPath = positionals[0];
  if (!notebookPath) {
    process.stderr.write(
      "usage: render <notebook.yaml> [--server NAME|URL --graph ID --token T] [--watch] [--timeout MS] [--compact]\n",
    );
    return 2;
  }
  // A non-numeric --timeout would become NaN → setTimeout(NaN) fires immediately;
  // fall back to the default unless it parses to a positive number.
  const parsedTimeout =
    typeof values.timeout === "string" ? Number(values.timeout) : Number.NaN;
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 30_000;
  const compact = values.compact === true;
  const opts = sourceOptionsFrom(values);

  if (values.watch !== true) {
    return renderOnce(notebookPath, opts, timeoutMs, compact);
  }

  // Watch mode: render now, then re-render on file change. Errors are reported
  // but don't tear down the watcher. Holds until Ctrl-C.
  await safeRender(notebookPath, opts, timeoutMs, compact);
  let running = false;
  watch(notebookPath, () => {
    if (running) return;
    running = true;
    // Debounce editor atomic-saves (write + rename can fire twice).
    setTimeout(() => {
      void safeRender(notebookPath, opts, timeoutMs, compact).finally(() => {
        running = false;
      });
    }, 50);
  });
  return new Promise<number>(() => {});
}

async function safeRender(
  notebookPath: string,
  opts: SourceOptions,
  timeoutMs: number,
  compact: boolean,
): Promise<void> {
  try {
    await renderOnce(notebookPath, opts, timeoutMs, compact);
  } catch (err) {
    process.stderr.write(
      `render: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

async function renderOnce(
  notebookPath: string,
  opts: SourceOptions,
  timeoutMs: number,
  compact: boolean,
): Promise<number> {
  const loaded = loadNotebook(notebookPath);
  const { source } = buildSource(loaded, opts);
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
    process.stdout.write(`${JSON.stringify(out, null, compact ? 0 : 2)}\n`);
    return snapshot.status === "fatal" ? 1 : 0;
  } finally {
    runtime.dispose();
  }
}
