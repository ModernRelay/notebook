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

  // Structural parse passed (errors already returned above, offline). The
  // remaining checks are intentionally server-bound: a dash-book's value is that
  // its cells resolve against the server-owned catalog, so `validate` resolves
  // the same operator-config source as view/render, capability-checks, and
  // validates catalog refs/params live. A notebook with no resolvable source
  // fails here by design — the meaningful validation can't run without one.
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

    if (loaded.notebook.cells.some(cellNeedsCatalog)) {
      try {
        const catalog = await client.queries();
        const { errors, warnings } = validateCatalogRefs(loaded.notebook, catalog);
        pushErrors(result, errors);
        if (warnings.length > 0) {
          result.warnings = [...(result.warnings ?? []), ...warnings];
        }
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
): { errors: ValidateResult["errors"]; warnings: string[] } {
  const errors: ValidateResult["errors"] = [];
  const warnings: string[] = [];
  const queries = new Map(catalog.queries.map((query) => [query.name, query]));

  notebook.cells.forEach((cell, index) => {
    // Data-cell read ref: must resolve to a READ query.
    const ref = cell.query?.ref;
    if (ref !== undefined) {
      const basePath = `cells/${index}/query`;
      const entry = queries.get(ref);
      if (entry === undefined) {
        errors.push({
          path: `${basePath}/ref`,
          message: `catalog query '${ref}' does not exist or is not exposed`,
          code: "unknown_ref",
        });
      } else {
        if (entry.mutation) {
          errors.push({
            path: `${basePath}/ref`,
            message: `catalog ref '${ref}' is a stored mutation; data cells require read queries`,
            code: "wrong_query_kind",
          });
        }
        const p = validateParamMap(
          cell.query?.params ?? {},
          entry.params,
          `${basePath}/params`,
          ref,
        );
        errors.push(...p.errors);
        warnings.push(...p.warnings);
      }
    }

    // Action mutations: a `ref` must resolve to a stored MUTATION; `rawGq` is a
    // capability-gated escape hatch (warn — can't catalog-check it).
    const actions = cell.props.actions;
    if (!Array.isArray(actions)) return;
    actions.forEach((action, aIdx) => {
      if (!action || typeof action !== "object") return;
      const mutation = (action as Record<string, unknown>).mutation;
      if (!mutation || typeof mutation !== "object") return;
      const m = mutation as { ref?: unknown; rawGq?: unknown; params?: unknown };
      const mBase = `cells/${index}/props/actions/${aIdx}/mutation`;
      if (typeof m.rawGq === "string") {
        warnings.push(
          `${mBase}.rawGq is a capability-gated escape hatch; prefer a catalog mutation.ref`,
        );
        return;
      }
      if (typeof m.ref !== "string") return; // schema-invalid; the parse layer catches it
      const entry = queries.get(m.ref);
      if (entry === undefined) {
        errors.push({
          path: `${mBase}/ref`,
          message: `catalog mutation '${m.ref}' does not exist or is not exposed`,
          code: "unknown_ref",
        });
        return;
      }
      if (!entry.mutation) {
        errors.push({
          path: `${mBase}/ref`,
          message: `catalog ref '${m.ref}' is a read query; actions require a stored mutation`,
          code: "wrong_query_kind",
        });
      }
      const mp = validateParamMap(
        (m.params ?? {}) as Record<string, unknown>,
        entry.params,
        `${mBase}/params`,
        m.ref,
      );
      errors.push(...mp.errors);
      warnings.push(...mp.warnings);
    });
  });

  return { errors, warnings };
}

/** A cell needs the live catalog if it reads a `ref` or any action mutates a `ref`. */
function cellNeedsCatalog(cell: Cell): boolean {
  if (cell.query?.ref !== undefined) return true;
  const actions = cell.props.actions;
  if (!Array.isArray(actions)) return false;
  return actions.some(
    (a) =>
      a !== null &&
      typeof a === "object" &&
      typeof (a as { mutation?: { ref?: unknown } }).mutation?.ref === "string",
  );
}

function validateParamMap(
  params: Record<string, unknown>,
  descriptors: ParamDescriptor[],
  basePath: string,
  refName: string,
): { errors: ValidateResult["errors"]; warnings: string[] } {
  const errors: ValidateResult["errors"] = [];
  const warnings: string[] = [];
  const supplied = new Set(Object.keys(params));
  const byName = new Map(descriptors.map((param) => [param.name, param]));

  for (const [key, value] of Object.entries(params)) {
    const param = byName.get(key);
    if (param === undefined) {
      errors.push({
        path: `${basePath}/${escapeJsonPointer(key)}`,
        message: `unknown param '${key}' for catalog query '${refName}'`,
        code: "unknown_param",
      });
      continue;
    }
    const literal = literalForValidation(value);
    if (literal.kind === "dynamic") {
      // Resolves at runtime; validate can't see runtime state. A `$row` ref is
      // reliably present from the clicked row, so only warn for `$state`.
      if (!param.nullable && literal.source === "state") {
        warnings.push(
          `param '${key}' for catalog query '${refName}' is required and resolves from $state at runtime; validate can't confirm it will be set`,
        );
      }
      continue;
    }
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

  return { errors, warnings };
}

function literalForValidation(
  value: unknown,
):
  | { kind: "literal"; value: unknown }
  | { kind: "dynamic"; source: "state" | "row" } {
  // `{ $row: col }` resolves from the clicked row at runtime.
  if (isRecord(value) && "$row" in value) {
    return { kind: "dynamic", source: "row" };
  }
  if (isRecord(value) && "$state" in value) {
    return "default" in value
      ? { kind: "literal", value: value.default }
      : { kind: "dynamic", source: "state" };
  }
  return containsStateExpr(value)
    ? { kind: "dynamic", source: "state" }
    : { kind: "literal", value };
}

function containsStateExpr(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsStateExpr);
  const record = value as Record<string, unknown>;
  return (
    "$state" in record ||
    "$row" in record ||
    Object.values(record).some(containsStateExpr)
  );
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
