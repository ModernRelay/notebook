import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Client, ServerSource } from "@modernrelay/notebook-client";
import { FixtureSource } from "@modernrelay/notebook-fixture";
import { loadFixture } from "@modernrelay/notebook-fixture/node";
import { parseNotebook, type Notebook } from "@modernrelay/notebook-spec";
import type { Source } from "@modernrelay/notebook-runtime";

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
  mode: "fixture" | "server";
  /** Upstream omnigraph-server URL (server mode). */
  server?: string;
  token?: string;
  graphId?: string;
  branch?: string;
  label: string;
}

/**
 * Resolve fixture-vs-server + graph/token/branch from a notebook + CLI/env
 * options — the same selection the TUI uses (packages/tui/src/index.tsx).
 * Fixture wins when the notebook declares `fixture:`. Server-mode graph-id
 * precedence: flag → $OMNIGRAPH_GRAPH_ID → notebook. No I/O.
 */
export function resolveConnection(
  loaded: LoadedNotebook,
  opts: SourceOptions,
): Connection {
  const { notebook } = loaded;
  if (notebook.fixture) {
    return {
      mode: "fixture",
      label: `fixture: ${notebook.fixture}`,
      ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
    };
  }
  const server = opts.server ?? notebook.server;
  if (!server) {
    throw new Error(
      "notebook has neither `fixture:` nor `server:` (and no --server given)",
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
    mode: "server",
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
 * Build a runtime `Source` from a loaded notebook + options. Fixture mode loads
 * the fixture JSON from disk; server mode constructs a ServerSource (no I/O —
 * reads happen lazily).
 */
export function buildSource(
  loaded: LoadedNotebook,
  opts: SourceOptions,
): BuiltSource {
  const connection = resolveConnection(loaded, opts);
  if (connection.mode === "fixture") {
    const fixturePath = resolve(
      dirname(loaded.notebookPath),
      loaded.notebook.fixture as string,
    );
    return { source: new FixtureSource(loadFixture(fixturePath)), connection };
  }
  const client = new Client({
    baseUrl: connection.server as string,
    graphId: connection.graphId as string,
    ...(connection.token !== undefined ? { token: connection.token } : {}),
  });
  const source = new ServerSource(client, {
    ...(connection.branch !== undefined ? { branch: connection.branch } : {}),
  });
  return { source, connection };
}
