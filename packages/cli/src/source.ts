import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client, ServerSource } from "@modernrelay/notebook-client";
import { parseNotebook, type Notebook } from "@modernrelay/notebook-core";
import type { Source } from "@modernrelay/notebook-core";

export interface SourceOptions {
  server?: string;
  token?: string;
  branch?: string;
  graph?: string;
}

export interface LoadedNotebook {
  notebook: Notebook;
  /** Absolute path to the notebook file. */
  notebookPath: string;
}

/** Read + parse a notebook YAML from disk. Throws ZodError on invalid shape. */
export function loadNotebook(notebookPath: string): LoadedNotebook {
  const abs = resolve(notebookPath);
  const yaml = readFileSync(abs, "utf8");
  return { notebook: parseNotebook(yaml), notebookPath: abs };
}

/** Resolved connection params — the single source of truth for source selection. */
export interface Connection {
  /** Upstream omnigraph-server URL. */
  server: string;
  token?: string;
  graphId: string;
  branch?: string;
  label: string;
}

/**
 * Resolve the omnigraph-server connection from a notebook + CLI/env options —
 * the same selection the TUI uses (packages/tui/src/index.tsx). Server-mode
 * graph-id precedence: flag → $OMNIGRAPH_GRAPH_ID → notebook. No I/O.
 */
export function resolveConnection(
  loaded: LoadedNotebook,
  opts: SourceOptions,
): Connection {
  const { notebook } = loaded;
  const server = opts.server ?? notebook.server;
  if (!server) {
    throw new Error(
      "notebook has no `server:` (and no --server given)",
    );
  }
  const token =
    opts.token ??
    process.env.OMNIGRAPH_TOKEN ??
    process.env.OMNIGRAPH_BEARER_TOKEN;
  const graphId = opts.graph ?? process.env.OMNIGRAPH_GRAPH_ID ?? notebook.graph;
  if (!graphId) {
    throw new Error(
      "server mode requires a graph id (omnigraph-server 0.7.0+ is cluster-only) — " +
        "set `graph:` in the notebook, pass --graph <id>, or set $OMNIGRAPH_GRAPH_ID",
    );
  }
  return {
    server,
    graphId,
    label: `server: ${server} · graph: ${graphId}`,
    ...(token !== undefined ? { token } : {}),
    ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
  };
}

export interface BuiltSource {
  source: Source;
  connection: Connection;
}

/**
 * Build a runtime `Source` from a loaded notebook + options. Constructs a
 * `ServerSource` over the omnigraph SDK (no I/O — reads happen lazily).
 */
export function buildSource(
  loaded: LoadedNotebook,
  opts: SourceOptions,
): BuiltSource {
  const connection = resolveConnection(loaded, opts);
  const client = new Client({
    baseUrl: connection.server,
    graphId: connection.graphId,
    ...(connection.token !== undefined ? { token: connection.token } : {}),
  });
  const source = new ServerSource(client, {
    ...(connection.branch !== undefined ? { branch: connection.branch } : {}),
  });
  return { source, connection };
}
