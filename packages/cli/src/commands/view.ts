import { parseArgs } from "node:util";

import { SOURCE_OPTIONS, sourceOptionsFrom } from "../args.js";
import { serve } from "../serve.js";
import { loadNotebook, resolveConnection } from "../source.js";

/**
 * Open the notebook in a browser: a local server hosts the prebuilt web SPA and,
 * in server mode, reverse-proxies `/og` → the omnigraph-server with the token
 * injected server-side. Long-running — returns a promise that never resolves so
 * the process stays up until Ctrl-C.
 */
export async function viewCommand(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...SOURCE_OPTIONS,
      port: { type: "string" },
      "no-open": { type: "boolean" },
    },
  });
  const notebookPath = positionals[0];
  if (!notebookPath) {
    process.stderr.write(
      "usage: view <notebook.yaml> [--server URL --graph ID --token T] [--port N] [--no-open]\n",
    );
    return 2;
  }

  let port = 4321;
  if (typeof values.port === "string") {
    const parsed = Number(values.port);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      process.stderr.write(
        `invalid --port: ${values.port} (expected an integer 0–65535)\n`,
      );
      return 2;
    }
    port = parsed;
  }

  const loaded = loadNotebook(notebookPath);
  const connection = resolveConnection(loaded, sourceOptionsFrom(values));

  await serve({
    notebookPath: loaded.notebookPath,
    connection,
    port,
    open: values["no-open"] !== true,
  });

  // The HTTP server keeps the event loop alive; hold here until Ctrl-C so the
  // dispatcher never exits the process out from under it.
  return new Promise<number>(() => {});
}
