import type { ParseArgsConfig } from "node:util";

import type { SourceOptions } from "./source.js";

type OptionConfig = NonNullable<ParseArgsConfig["options"]>;

/** `--server/--graph/--token/--branch/--profile` — the source flags shared by most commands. */
export const SOURCE_OPTIONS: OptionConfig = {
  server: { type: "string" },
  token: { type: "string" },
  branch: { type: "string" },
  graph: { type: "string" },
  profile: { type: "string" },
};

/** Pull the resolved source options out of a parseArgs `values` bag. */
export function sourceOptionsFrom(
  values: Record<string, unknown>,
): SourceOptions {
  const out: SourceOptions = {};
  if (typeof values.server === "string") out.server = values.server;
  if (typeof values.token === "string") out.token = values.token;
  if (typeof values.branch === "string") out.branch = values.branch;
  if (typeof values.graph === "string") out.graph = values.graph;
  if (typeof values.profile === "string") out.profile = values.profile;
  return out;
}
