import React from "react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
import { parseNotebook } from "@omnigraph/notebook-spec";
import { FixtureSource } from "@omnigraph/fixture";
import { loadFixture } from "@omnigraph/fixture/node";
import { Client, ServerSource } from "@omnigraph/client";
import type { Source } from "@omnigraph/runtime";
import { App } from "./App.js";

interface ParsedArgs {
  notebookPath: string;
  server?: string;
  token?: string;
  branch?: string;
  graph?: string;
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
omnigraph-tui <notebook.yaml> [--server URL] [--token TOKEN] [--branch NAME] [--graph ID]

  Fixture mode  — when the notebook declares \`fixture: <relative-path>\`,
                  reads + writes go to the in-memory FixtureSource.
  Server mode   — when the notebook declares \`server: <URL>\` (or you pass
                  --server), reads + writes go to omnigraph-server. Bearer
                  token from --token or \$OMNIGRAPH_TOKEN. omnigraph-server
                  0.7.0+ is cluster-only, so a graph id is required: set
                  \`graph:\` in the notebook, pass --graph, or set
                  \$OMNIGRAPH_GRAPH_ID.

`);
}

export function main(argv: readonly string[]): void {
  const args = parseArgs(argv);
  const notebookAbs = resolve(args.notebookPath);
  const yaml = readFileSync(notebookAbs, "utf8");
  const notebook = parseNotebook(yaml);

  // CLI flags > notebook fields. Falls back to env for token only.
  // OMNIGRAPH_BEARER_TOKEN is the conventional omnigraph env var (server +
  // CLI use it); accept it so plain `omnigraph-tui <nb>` works without an
  // OMNIGRAPH_TOKEN alias.
  const serverUrl = args.server ?? notebook.server;
  const token =
    args.token ??
    process.env.OMNIGRAPH_TOKEN ??
    process.env.OMNIGRAPH_BEARER_TOKEN;
  // omnigraph-server 0.7.0+ is cluster-only; every read/write is graph-scoped.
  const graphId =
    args.graph ?? notebook.graph ?? process.env.OMNIGRAPH_GRAPH_ID;

  let source: Source;
  let label: string;

  if (notebook.fixture) {
    const fixturePath = resolve(dirname(notebookAbs), notebook.fixture);
    const fixture = loadFixture(fixturePath);
    source = new FixtureSource(fixture);
    label = `fixture: ${notebook.fixture}`;
  } else if (serverUrl) {
    if (!graphId) {
      process.stderr.write(
        `omnigraph-tui: server mode requires a graph id (omnigraph-server 0.7.0+\n` +
          `is cluster-only). Set \`graph:\` in the notebook, pass --graph <id>,\n` +
          `or set $OMNIGRAPH_GRAPH_ID.\n`,
      );
      process.exit(2);
    }
    const client = new Client({
      baseUrl: serverUrl,
      graphId,
      ...(token !== undefined ? { token } : {}),
    });
    source = new ServerSource(client, {
      ...(args.branch !== undefined ? { branch: args.branch } : {}),
    });
    label = `server: ${serverUrl} · graph: ${graphId}`;
  } else {
    process.stderr.write(
      `omnigraph-tui: notebook has neither \`fixture:\` nor \`server:\`,\n` +
        `and no --server flag was given. Set one of the three.\n`,
    );
    process.exit(2);
  }

  render(
    <App
      notebook={notebook}
      source={source}
      label={label}
      autoExit={RAN_NON_TTY}
    />,
  );
}
