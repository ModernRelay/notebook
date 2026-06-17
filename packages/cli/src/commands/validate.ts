import { parseArgs } from "node:util";

import { validateNotebookCompatibility } from "@omnigraph/runtime";
import { z } from "zod";

import { SOURCE_OPTIONS, sourceOptionsFrom } from "../args.js";
import { buildSource, loadNotebook, type LoadedNotebook } from "../source.js";

interface ValidateResult {
  ok: boolean;
  errors: Array<{ path: string; message: string; code: string }>;
  warnings?: string[];
}

/**
 * Parse a notebook and (when a source can be built) capability-check it. Emits a
 * structured `{ ok, errors[], warnings? }` with `--json`, or a human summary.
 * Exit 0 = valid, 1 = invalid, 2 = usage.
 */
export function validateCommand(argv: string[]): number {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { ...SOURCE_OPTIONS, json: { type: "boolean" } },
  });
  const notebookPath = positionals[0];
  const asJson = values.json === true;
  if (!notebookPath) {
    process.stderr.write(
      "usage: validate <notebook.yaml> [--server URL --graph ID] [--json]\n",
    );
    return 2;
  }

  let loaded: LoadedNotebook;
  try {
    loaded = loadNotebook(notebookPath);
  } catch (err) {
    emit(toParseError(err), asJson);
    return 1;
  }

  // Structural parse passed. Capability-check against a source when the notebook
  // (or a --server flag) points at one — this also loads + validates the fixture.
  const result: ValidateResult = { ok: true, errors: [] };
  const sourceOpts = sourceOptionsFrom(values);
  const hasSource = Boolean(
    loaded.notebook.fixture || loaded.notebook.server || sourceOpts.server,
  );
  if (hasSource) {
    try {
      const { source } = buildSource(loaded, sourceOpts);
      const compat = validateNotebookCompatibility(
        loaded.notebook,
        source.capabilities(),
      );
      if (compat.warnings.length > 0) result.warnings = compat.warnings;
      if (compat.errors.length > 0) {
        result.ok = false;
        result.errors = compat.errors.map((message) => ({
          path: "",
          message,
          code: "incompatible",
        }));
      }
    } catch (err) {
      result.ok = false;
      result.errors.push({
        path: "",
        message: err instanceof Error ? err.message : String(err),
        code: "source",
      });
    }
  }
  emit(result, asJson);
  return result.ok ? 0 : 1;
}

function toParseError(err: unknown): ValidateResult {
  if (err instanceof z.ZodError) {
    return {
      ok: false,
      errors: err.issues.map((issue) => ({
        path: issue.path.join("/"),
        message: issue.message,
        code: issue.code,
      })),
    };
  }
  return {
    ok: false,
    errors: [
      {
        path: "",
        message: err instanceof Error ? err.message : String(err),
        code: "parse",
      },
    ],
  };
}

function emit(result: ValidateResult, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.ok) {
    process.stdout.write("✓ valid notebook\n");
    for (const warning of result.warnings ?? []) {
      process.stdout.write(`  warning: ${warning}\n`);
    }
  } else {
    process.stderr.write("✗ invalid notebook\n");
    for (const e of result.errors) {
      process.stderr.write(
        `  ${e.path ? `${e.path}: ` : ""}${e.message} (${e.code})\n`,
      );
    }
  }
}
