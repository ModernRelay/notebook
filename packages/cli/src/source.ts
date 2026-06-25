import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Client, ServerSource } from "@modernrelay/notebook-client";
import { resolveConnection as resolveOperatorConnection } from "@modernrelay/notebook-client/node";
import { parseNotebook, type Notebook } from "@modernrelay/notebook-core";
import type { Source } from "@modernrelay/notebook-core";

export interface SourceOptions {
  /** `--server` — operator-config server name or a literal URL. */
  server?: string;
  token?: string;
  branch?: string;
  graph?: string;
  /** `--profile` — named operator-config profile. */
  profile?: string;
  /** `--allow-raw-gq` — enable the raw `.gq` escape hatch (off by default). */
  allowRawGq?: boolean;
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

/** Resolved connection — the single source of truth for source selection. */
export interface Connection {
  /** Resolved omnigraph-server base URL. */
  server: string;
  token?: string;
  graphId: string;
  branch?: string;
  label: string;
}

/**
 * Resolve the omnigraph-server connection by layering CLI flags over the
 * omnigraph operator config (`~/.omnigraph/config.yaml` + `credentials`) and
 * the notebook's declared `server`/`graph`. Shared with the TUI via
 * `@modernrelay/notebook-client/node`. No graph I/O.
 */
export function resolveConnection(
  loaded: LoadedNotebook,
  opts: SourceOptions,
): Connection {
  const r = resolveOperatorConnection(
    {
      ...(opts.server !== undefined ? { server: opts.server } : {}),
      ...(opts.graph !== undefined ? { graph: opts.graph } : {}),
      ...(opts.token !== undefined ? { token: opts.token } : {}),
      ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
      ...(opts.profile !== undefined ? { profile: opts.profile } : {}),
    },
    {
      ...(loaded.notebook.server !== undefined
        ? { server: loaded.notebook.server }
        : {}),
      ...(loaded.notebook.graph !== undefined
        ? { graph: loaded.notebook.graph }
        : {}),
    },
  );
  return {
    server: r.baseUrl,
    graphId: r.graphId,
    label: r.label,
    ...(r.token !== undefined ? { token: r.token } : {}),
    ...(r.branch !== undefined ? { branch: r.branch } : {}),
  };
}

export interface BuiltSource {
  source: Source;
  client: Client;
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
    ...(opts.allowRawGq ? { allowRawGq: true } : {}),
  });
  return { source, client, connection };
}
