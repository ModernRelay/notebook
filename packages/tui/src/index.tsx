import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// When stdin isn't a TTY (CI, piped runs, smoke tests), Ink + @json-render/ink
// throw inside `useInput` because raw mode isn't available. We stub the few
// stdin properties they check so the renderer mounts a single frame, then we
// auto-exit from <App />. The check has to happen *before* `import "ink"`.
const RAN_NON_TTY = !process.stdin.isTTY;
if (RAN_NON_TTY) {
  const stdin = process.stdin as NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => unknown;
    isRaw?: boolean;
    isTTY?: boolean;
    ref?: () => unknown;
    unref?: () => unknown;
  };
  stdin.setRawMode = () => stdin;
  stdin.isRaw = false;
  stdin.isTTY = true;
  if (typeof stdin.ref !== "function") stdin.ref = () => stdin;
  if (typeof stdin.unref !== "function") stdin.unref = () => stdin;
}

import { render } from "ink";
import { parseNotebook } from "@modernrelay/notebook-core";
import { Client, ServerSource } from "@modernrelay/notebook-client";
import { resolveConnection } from "@modernrelay/notebook-client/node";
import type { Source } from "@modernrelay/notebook-core";
import { App } from "./App.js";

interface ParsedArgs {
  notebookPath: string;
  server?: string;
  token?: string;
  branch?: string;
  graph?: string;
  profile?: string;
  allowRawGq?: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { notebookPath: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--server") {
      out.server = argv[++i];
    } else if (a === "--token") {
      out.token = argv[++i];
    } else if (a === "--branch") {
      out.branch = argv[++i];
    } else if (a === "--graph") {
      out.graph = argv[++i];
    } else if (a === "--profile") {
      out.profile = argv[++i];
    } else if (a === "--allow-raw-gq") {
      out.allowRawGq = true;
    } else if (a === "-h" || a === "--help") {
      printUsage();
      process.exit(0);
    } else if (!a.startsWith("-")) {
      out.notebookPath = a;
    }
  }
  if (!out.notebookPath) {
    printUsage();
    process.exit(2);
  }
  return out;
}

function printUsage(): void {
  process.stderr.write(`
omnigraph-tui <notebook.yaml> [--server NAME|URL] [--graph ID] [--token TOKEN] [--branch NAME] [--profile NAME] [--allow-raw-gq]

  Reads + writes go to omnigraph-server via the @modernrelay/omnigraph SDK.
  Connection resolves from flags, then omnigraph operator config
  (~/.omnigraph/config.yaml + credentials), then the notebook's \`server:\`/
  \`graph:\`. With operator config set up (\`omnigraph login\`), no flags are
  needed. omnigraph-server 0.7.0+ is cluster-only, so a graph id is required.

`);
}

export function main(argv: readonly string[]): void {
  const args = parseArgs(argv);
  const notebookAbs = resolve(args.notebookPath);
  const yaml = readFileSync(notebookAbs, "utf8");
  const notebook = parseNotebook(yaml);

  let conn;
  try {
    conn = resolveConnection(
      {
        ...(args.server !== undefined ? { server: args.server } : {}),
        ...(args.graph !== undefined ? { graph: args.graph } : {}),
        ...(args.token !== undefined ? { token: args.token } : {}),
        ...(args.branch !== undefined ? { branch: args.branch } : {}),
        ...(args.profile !== undefined ? { profile: args.profile } : {}),
      },
      {
        ...(notebook.server !== undefined ? { server: notebook.server } : {}),
        ...(notebook.graph !== undefined ? { graph: notebook.graph } : {}),
      },
    );
  } catch (err) {
    process.stderr.write(
      `omnigraph-tui: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  const client = new Client({
    baseUrl: conn.baseUrl,
    graphId: conn.graphId,
    ...(conn.token !== undefined ? { token: conn.token } : {}),
  });
  const source: Source = new ServerSource(client, {
    ...(conn.branch !== undefined ? { branch: conn.branch } : {}),
    ...(args.allowRawGq ? { allowRawGq: true } : {}),
  });
  const label = conn.label;

  render(
    <App
      notebook={notebook}
      source={source}
      label={label}
      autoExit={RAN_NON_TTY}
    />,
  );
}
