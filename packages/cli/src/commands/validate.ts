import { parseArgs } from "node:util";

import {
  validateNotebookCompatibility,
  type Cell,
  type Notebook,
} from "@modernrelay/notebook-core";
import type {
  ParamDescriptor,
  QueriesOutput,
} from "@modernrelay/notebook-client";
import { z } from "zod";

import { SOURCE_OPTIONS, sourceOptionsFrom } from "../args.js";
import { buildSource, loadNotebook, type LoadedNotebook } from "../source.js";

interface ValidateResult {
  ok: boolean;
  errors: Array<{ path: string; message: string; code: string }>;
  warnings?: string[];
}

/**
 * Parse a notebook, resolve the operator-config-backed source, capability-check
 * it, and validate named query refs against the live catalog. Emits a structured
 * `{ ok, errors[], warnings? }` with `--json`, or a human summary. Exit 0 =
 * valid, 1 = invalid, 2 = usage.
 */
export async function validateCommand(argv: string[]): Promise<number> {
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

  // Structural parse passed. Resolve the same operator-config-backed source
  // path as view/render, then capability-check and validate catalog refs.
  const result: ValidateResult = { ok: true, errors: [] };
  const sourceOpts = sourceOptionsFrom(values);
  try {
    const { source, client } = buildSource(loaded, sourceOpts);
    const compat = validateNotebookCompatibility(
      loaded.notebook,
      source.capabilities(),
    );
    if (compat.warnings.length > 0) result.warnings = compat.warnings;
    if (compat.errors.length > 0) {
      pushErrors(
        result,
        compat.errors.map((message) => ({
          path: "",
          message,
          code: "incompatible",
        })),
      );
    }

    if (loaded.notebook.cells.some((cell) => cell.query?.ref !== undefined)) {
      try {
        const catalog = await client.queries();
        pushErrors(result, validateCatalogRefs(loaded.notebook, catalog));
      } catch (err) {
        // Distinguish "server unreachable" from a config/source error so the
        // message says what's actually needed (catalog refs need a live server).
        pushErrors(result, [
          {
            path: "",
            message: `catalog validation requires a reachable server: ${
              err instanceof Error ? err.message : String(err)
            }`,
            code: "catalog_unreachable",
          },
        ]);
      }
    }
  } catch (err) {
    pushErrors(result, [
      {
        path: "",
        message: err instanceof Error ? err.message : String(err),
        code: "source",
      },
    ]);
  }
  emit(result, asJson);
  return result.ok ? 0 : 1;
}

function pushErrors(
  result: ValidateResult,
  errors: ValidateResult["errors"],
): void {
  if (errors.length === 0) return;
  result.ok = false;
  result.errors.push(...errors);
}

function validateCatalogRefs(
  notebook: Notebook,
  catalog: QueriesOutput,
): ValidateResult["errors"] {
  const errors: ValidateResult["errors"] = [];
  const queries = new Map(catalog.queries.map((query) => [query.name, query]));

  notebook.cells.forEach((cell, index) => {
    const ref = cell.query?.ref;
    if (ref === undefined) return;
    const entry = queries.get(ref);
    const basePath = `cells/${index}/query`;
    if (entry === undefined) {
      errors.push({
        path: `${basePath}/ref`,
        message: `catalog query '${ref}' does not exist or is not exposed`,
        code: "unknown_ref",
      });
      return;
    }
    if (entry.mutation) {
      errors.push({
        path: `${basePath}/ref`,
        message: `catalog ref '${ref}' is a stored mutation; data cells require read queries`,
        code: "wrong_query_kind",
      });
    }
    errors.push(...validateParams(cell, index, entry.params));
  });

  return errors;
}

function validateParams(
  cell: Cell,
  index: number,
  descriptors: ParamDescriptor[],
): ValidateResult["errors"] {
  const errors: ValidateResult["errors"] = [];
  const basePath = `cells/${index}/query/params`;
  const params = cell.query?.params ?? {};
  const supplied = new Set(Object.keys(params));
  const byName = new Map(descriptors.map((param) => [param.name, param]));

  for (const [key, value] of Object.entries(params)) {
    const param = byName.get(key);
    if (param === undefined) {
      errors.push({
        path: `${basePath}/${escapeJsonPointer(key)}`,
        message: `unknown param '${key}' for catalog query '${cell.query?.ref ?? ""}'`,
        code: "unknown_param",
      });
      continue;
    }
    const literal = literalForValidation(value);
    if (literal.kind === "dynamic") continue;
    const message = validateParamValue(literal.value, param);
    if (message !== null) {
      errors.push({
        path: `${basePath}/${escapeJsonPointer(key)}`,
        message,
        code: "invalid_param",
      });
    }
  }

  for (const param of descriptors) {
    if (!param.nullable && !supplied.has(param.name)) {
      errors.push({
        path: `${basePath}/${escapeJsonPointer(param.name)}`,
        message: `missing required param '${param.name}'`,
        code: "missing_param",
      });
    }
  }

  return errors;
}

function literalForValidation(
  value: unknown,
): { kind: "literal"; value: unknown } | { kind: "dynamic" } {
  if (isRecord(value) && "$state" in value) {
    return "default" in value
      ? { kind: "literal", value: value.default }
      : { kind: "dynamic" };
  }
  return containsStateExpr(value)
    ? { kind: "dynamic" }
    : { kind: "literal", value };
}

function containsStateExpr(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsStateExpr);
  const record = value as Record<string, unknown>;
  return "$state" in record || Object.values(record).some(containsStateExpr);
}

function validateParamValue(
  value: unknown,
  param: ParamDescriptor,
): string | null {
  if (value === null || value === undefined) {
    return param.nullable
      ? null
      : `param '${param.name}' is required and must be ${describeParam(param)}`;
  }
  switch (param.kind) {
    case "string":
    case "bigint":
    case "date":
    case "datetime":
    case "blob":
      return typeof value === "string"
        ? null
        : `param '${param.name}' must be ${describeParam(param)}`;
    case "bool":
      return typeof value === "boolean"
        ? null
        : `param '${param.name}' must be ${describeParam(param)}`;
    case "int":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `param '${param.name}' must be ${describeParam(param)}`;
    case "float":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `param '${param.name}' must be ${describeParam(param)}`;
    case "vector":
      if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === "number")
      ) {
        return `param '${param.name}' must be ${describeParam(param)}`;
      }
      if (
        typeof param.vector_dim === "number" &&
        param.vector_dim > 0 &&
        value.length !== param.vector_dim
      ) {
        return `param '${param.name}' must have ${param.vector_dim} vector dimensions`;
      }
      return null;
    case "list":
      if (!Array.isArray(value)) {
        return `param '${param.name}' must be ${describeParam(param)}`;
      }
      if (param.item_kind === undefined || param.item_kind === null) return null;
      for (const item of value) {
        const itemParam: ParamDescriptor = {
          ...param,
          kind: param.item_kind,
          item_kind: undefined,
          nullable: false,
        };
        const message = validateParamValue(item, itemParam);
        if (message !== null) {
          return `param '${param.name}' items must be ${param.item_kind}`;
        }
      }
      return null;
  }
}

function describeParam(param: ParamDescriptor): string {
  if (param.kind === "list" && param.item_kind) {
    return `list<${param.item_kind}>${param.nullable ? " or null" : ""}`;
  }
  if (param.kind === "vector" && param.vector_dim) {
    return `vector[${param.vector_dim}]${param.nullable ? " or null" : ""}`;
  }
  return `${param.kind}${param.nullable ? " or null" : ""}`;
}

function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
