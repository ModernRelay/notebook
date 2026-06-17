import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { NotebookSchema } from "@omnigraph/notebook-spec";
import { z } from "zod";

/**
 * JSON Schema for a notebook YAML, generated from the Zod `NotebookSchema`.
 * `io: "input"` keeps `.default()`-ed fields optional (we validate hand-written
 * YAML, not post-parse output). Refinements (mutual-exclusion rules) are
 * runtime-only and aren't representable — `validate` stays the authoritative gate.
 */
export function notebookJsonSchema(): unknown {
  return z.toJSONSchema(NotebookSchema, { io: "input" });
}

export async function schemaCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { out: { type: "string" } },
  });
  const json = `${JSON.stringify(notebookJsonSchema(), null, 2)}\n`;
  if (typeof values.out === "string") {
    await writeFile(values.out, json);
  } else {
    process.stdout.write(json);
  }
  return 0;
}
