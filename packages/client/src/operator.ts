/**
 * Node-only omnigraph operator-config resolver (RFC-011).
 *
 * Reads the same client-side connection context the `omnigraph` CLI uses, so a
 * notebook can connect with zero flags once you've `omnigraph login`'d:
 *   - `~/.omnigraph/config.yaml`  — `servers` (name→URL), `defaults`, `profiles`
 *   - `~/.omnigraph/credentials`  — INI, `0600`-enforced, `[server] token=…`
 *
 * Imported only via `@modernrelay/notebook-client/node` (uses `node:fs`), never
 * from the browser bundle. The web app gets its connection from the `view`
 * proxy / URL params instead.
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ConnectionFlags {
  /** `--server` — an operator-config server name OR a literal URL. */
  server?: string;
  /** `--graph` — cluster graph id. */
  graph?: string;
  /** `--token` — explicit bearer token (wins over config/env). */
  token?: string;
  /** `--branch` — default read/write branch. */
  branch?: string;
  /** `--profile` — named operator-config profile (else `$OMNIGRAPH_PROFILE`). */
  profile?: string;
}

export interface ResolvedConnection {
  baseUrl: string;
  graphId: string;
  token?: string;
  branch?: string;
  /** Human-readable summary for startup banners. */
  label: string;
}

interface OperatorConfig {
  servers: Record<string, { url?: string }>;
  defaults: { server?: string; default_graph?: string };
  profiles: Record<string, { server?: string; default_graph?: string }>;
}

/** `$OMNIGRAPH_HOME` (tilde-expanded) or `~/.omnigraph`. */
function operatorHome(): string {
  const home = process.env.OMNIGRAPH_HOME;
  if (home && home.length > 0) {
    return home.startsWith("~") ? join(homedir(), home.slice(1)) : home;
  }
  return join(homedir(), ".omnigraph");
}

function loadOperatorConfig(): OperatorConfig {
  const empty: OperatorConfig = { servers: {}, defaults: {}, profiles: {} };
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(join(operatorHome(), "config.yaml"), "utf8"));
  } catch {
    return empty; // absent or unreadable config is not an error
  }
  if (!raw || typeof raw !== "object") return empty;
  const obj = raw as Record<string, unknown>;
  return {
    servers: (obj.servers as OperatorConfig["servers"]) ?? {},
    defaults: (obj.defaults as OperatorConfig["defaults"]) ?? {},
    profiles: (obj.profiles as OperatorConfig["profiles"]) ?? {},
  };
}

/** Parse `~/.omnigraph/credentials` (INI). Refuses an over-permissive file. */
function loadCredentials(): Record<string, string> {
  const path = join(operatorHome(), "credentials");
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    return {}; // absent → no keyed tokens
  }
  // 0600: reject if group/other have any bits (POSIX only; mode is 0 on Windows).
  if ((stat.mode & 0o077) !== 0 && process.platform !== "win32") {
    throw new Error(
      `${path} is over-permissive (mode ${(stat.mode & 0o777).toString(8)}); ` +
        `omnigraph requires 0600 — run \`chmod 600 ${path}\``,
    );
  }
  const out: Record<string, string> = {};
  let section = "";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";"))
      continue;
    const sec = /^\[(.+)\]$/.exec(trimmed);
    if (sec?.[1] !== undefined) {
      section = sec[1].trim();
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "token" && section) out[section] = value;
  }
  return out;
}

/** Keyed-token env var for a server name: `prod` → `OMNIGRAPH_TOKEN_PROD`. */
function tokenEnvVar(serverName: string): string {
  return `OMNIGRAPH_TOKEN_${serverName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function isUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://") || s.startsWith("/");
}

/**
 * Resolve a server-scope connection from flags + the notebook's declared
 * `server`/`graph`, layering omnigraph operator config underneath.
 *
 * Precedence — server: flag → profile → defaults → notebook. A name resolves to
 * a URL via `servers`; a literal URL is used as-is. graph: flag → profile/defaults
 * → notebook. token: flag → `$OMNIGRAPH_TOKEN_<SERVER>` → credentials[server] →
 * `$OMNIGRAPH_BEARER_TOKEN`.
 */
export function resolveConnection(
  flags: ConnectionFlags,
  notebook: { server?: string; graph?: string } = {},
): ResolvedConnection {
  const config = loadOperatorConfig();
  const profileName = flags.profile ?? process.env.OMNIGRAPH_PROFILE;
  const profile = profileName ? config.profiles[profileName] : undefined;
  if (profileName && !profile) {
    throw new Error(`unknown operator profile '${profileName}' in config.yaml`);
  }

  const serverRef =
    flags.server ?? profile?.server ?? config.defaults.server ?? notebook.server;
  if (!serverRef) {
    throw new Error(
      "no server: pass --server <name|URL>, set a profile/default in " +
        "~/.omnigraph/config.yaml, or declare `server:` in the notebook",
    );
  }

  // A literal URL is used directly (no name → no keyed token); a name resolves
  // via the servers registry.
  let baseUrl: string;
  let serverName: string | undefined;
  if (isUrl(serverRef)) {
    baseUrl = serverRef;
  } else {
    const entry = config.servers[serverRef];
    if (!entry?.url) {
      throw new Error(
        `server '${serverRef}' is not defined in ~/.omnigraph/config.yaml servers:`,
      );
    }
    baseUrl = entry.url;
    serverName = serverRef;
  }

  const graphId =
    flags.graph ??
    profile?.default_graph ??
    config.defaults.default_graph ??
    notebook.graph;
  if (!graphId) {
    throw new Error(
      "server mode requires a graph id (omnigraph-server 0.7.0+ is cluster-only) — " +
        "pass --graph <id>, set default_graph in config.yaml, or declare `graph:` in the notebook",
    );
  }

  const credentials = serverName ? loadCredentials() : {};
  const token =
    flags.token ??
    (serverName ? process.env[tokenEnvVar(serverName)] : undefined) ??
    (serverName ? credentials[serverName] : undefined) ??
    process.env.OMNIGRAPH_BEARER_TOKEN;

  return {
    baseUrl,
    graphId,
    ...(token !== undefined ? { token } : {}),
    ...(flags.branch !== undefined ? { branch: flags.branch } : {}),
    label: `server: ${serverName ? `${serverName} (${baseUrl})` : baseUrl} · graph: ${graphId}${flags.branch ? ` · ${flags.branch}` : ""}`,
  };
}
