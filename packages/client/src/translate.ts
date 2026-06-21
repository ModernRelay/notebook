/**
 * Pure translators from the fixture-DSL (the same DSL that powers
 * `@modernrelay/notebook-fixture`'s in-memory runner) into the parameterized `.gq`
 * source that omnigraph-server speaks.
 *
 * Output shape for every translator:
 *   { query_source: string, query_name: string, params: Record<string, unknown> }
 *
 * - `query_source` is one .gq query block.
 * - `query_name` matches the block's name so the server can pick it.
 * - `params` is the bag of named parameters the .gq query references.
 *
 * Grammar mapped to:
 *   crates/omnigraph-compiler/src/query/query.pest:30-93
 *   docs/query-language.md (MATCH/RETURN/ORDER/LIMIT + UPDATE)
 */

import type {
  FixtureNodesQuery,
  FixturePathQuery,
  FixtureQuery,
  MutationParams,
} from "@modernrelay/notebook-core";

export interface TranslatedQuery {
  query_source: string;
  query_name: string;
  params: Record<string, unknown>;
}

export class UnsupportedTranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTranslationError";
  }
}

const COMP_OPS = new Set([">=", "<=", "!=", ">", "<", "="]);
const VAR_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Convert PascalCase / snake_case / camelCase edge name to the .gq
 * predicate form (lowercase first char of PascalCase).
 *
 * The .pg schema declares edges as PascalCase (e.g. `HasClause`); .gq
 * queries reference them as `hasClause`. This mirrors the compiler's
 * own naming convention.
 */
export function edgeToPredicate(name: string): string {
  // First normalize to PascalCase, then lowercase the leading char.
  const pascal = name.replace(/(^|[_-])([a-z])/g, (_, __, c) => c.toUpperCase());
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

// ── translateNodesQuery ───────────────────────────────────────────────────

/**
 * `kind: nodes` → MATCH a single node binding with optional where filters,
 * RETURN the projected fields, optional ORDER BY + LIMIT.
 *
 * Note: a `nodes` query without a `where.type` becomes an unfiltered match
 * over all nodes of the only-binding's implicit type — but .gq requires a
 * type on every binding. We treat `where.type` as required at translation
 * time and throw a clear error if it's missing.
 */
export function translateNodesQuery(
  q: FixtureNodesQuery,
  queryName = "ng_nodes",
): TranslatedQuery {
  const typ = q.where?.type;
  if (typeof typ !== "string" || !typ) {
    throw new UnsupportedTranslationError(
      "translateNodesQuery: `where.type` is required (server mode needs a typed binding for `match`)",
    );
  }
  const params: Record<string, unknown> = {};
  const paramDecls: string[] = [];
  const matchClauses: string[] = [`$n: ${typ}`];

  for (const [k, v] of Object.entries(q.where ?? {})) {
    if (k === "type") continue;
    if (!FIELD_PATTERN.test(k)) {
      throw new UnsupportedTranslationError(
        `translateNodesQuery: invalid field name '${k}'`,
      );
    }
    const pname = paramName("w", k, params, paramDecls, v);
    matchClauses.push(`$n.${k} = $${pname}`);
  }

  const projectFields = q.project ?? ["id"];
  const returnList = projectFields
    .map((f) => {
      if (!FIELD_PATTERN.test(f)) {
        throw new UnsupportedTranslationError(
          `translateNodesQuery: invalid projection '${f}'`,
        );
      }
      return `$n.${f} as ${f}`;
    })
    .join(", ");

  let body = `match {\n  ${matchClauses.join("\n  ")}\n}\nreturn { ${returnList} }`;
  if (q.order_by) {
    if (!FIELD_PATTERN.test(q.order_by.field)) {
      throw new UnsupportedTranslationError(
        `translateNodesQuery: invalid order_by field '${q.order_by.field}'`,
      );
    }
    body += `\norder { $n.${q.order_by.field} ${q.order_by.direction} }`;
  }
  if (q.limit !== undefined) {
    body += `\nlimit ${Math.trunc(q.limit)}`;
  }

  const decls = paramDecls.length > 0 ? `(${paramDecls.join(", ")})` : "()";
  return {
    query_name: queryName,
    query_source: `query ${queryName}${decls} {\n${body}\n}\n`,
    params,
  };
}

// ── translatePathQuery ────────────────────────────────────────────────────

/**
 * `kind: path` → a single MATCH with multiple traversal clauses, plus a
 * RETURN that projects literals and var-refs.
 *
 * Direction handling: forward edges become `$src predicate $dst`; reverse
 * edges flip the source/target relationship by binding the upstream node
 * as the *target* of the edge — which in .gq is the SAME `$src predicate
 * $dst` shape, but the source lookup happens on what we call `dst`. We
 * achieve this by swapping the source/target vars in the emitted clause.
 */
export function translatePathQuery(
  q: FixturePathQuery,
  queryName = "ng_path",
): TranslatedQuery {
  const params: Record<string, unknown> = {};
  const paramDecls: string[] = [];
  const matchClauses: string[] = [];
  const seenVars = new Set<string>();

  for (let i = 0; i < q.steps.length; i++) {
    const step = q.steps[i]!;
    if (!VAR_PATTERN.test(step.var)) {
      throw new UnsupportedTranslationError(
        `translatePathQuery: invalid var '${step.var}'`,
      );
    }
    if (seenVars.has(step.var)) {
      throw new UnsupportedTranslationError(
        `translatePathQuery: duplicate var '${step.var}'`,
      );
    }
    seenVars.add(step.var);

    if (i === 0) {
      // First step: bind a typed node.
      if (!step.type) {
        throw new UnsupportedTranslationError(
          "translatePathQuery: first step must declare `type`",
        );
      }
      matchClauses.push(`$${step.var}: ${step.type}`);
      continue;
    }

    if (!step.edge) {
      throw new UnsupportedTranslationError(
        `translatePathQuery: step '${step.var}' is not the first step and must declare an edge`,
      );
    }
    const prevVar = q.steps[i - 1]!.var;
    const predicate = edgeToPredicate(step.edge);
    const direction = step.direction ?? "out";

    // Bind the new node first (so the type filter is visible).
    if (step.type) {
      matchClauses.push(`$${step.var}: ${step.type}`);
    }
    // Edge clause. Forward: prev -> step. Reverse: step -> prev.
    if (direction === "out") {
      matchClauses.push(`$${prevVar} ${predicate} $${step.var}`);
    } else {
      matchClauses.push(`$${step.var} ${predicate} $${prevVar}`);
    }
  }

  const returnParts: string[] = [];
  for (const proj of q.project) {
    if (proj.literal !== undefined) {
      const pname = paramName("lit", proj.as, params, paramDecls, proj.literal);
      returnParts.push(`$${pname} as ${proj.as}`);
      continue;
    }
    if (proj.var === undefined) {
      throw new UnsupportedTranslationError(
        "translatePathQuery: projection needs `var` or `literal`",
      );
    }
    // `var.field` or bare `var` (we always require `.field` for path projections).
    const dot = proj.var.indexOf(".");
    if (dot < 0) {
      throw new UnsupportedTranslationError(
        `translatePathQuery: projection var '${proj.var}' must reference a field (e.g. 'a.title')`,
      );
    }
    const v = proj.var.slice(0, dot);
    const f = proj.var.slice(dot + 1);
    if (!seenVars.has(v) || !FIELD_PATTERN.test(f)) {
      throw new UnsupportedTranslationError(
        `translatePathQuery: invalid projection '${proj.var}'`,
      );
    }
    returnParts.push(`$${v}.${f} as ${proj.as}`);
  }

  const decls = paramDecls.length > 0 ? `(${paramDecls.join(", ")})` : "()";
  const body = `match {\n  ${matchClauses.join("\n  ")}\n}\nreturn { ${returnParts.join(", ")} }`;
  return {
    query_name: queryName,
    query_source: `query ${queryName}${decls} {\n${body}\n}\n`,
    params,
  };
}

// ── translateFixtureQuery (dispatch) ──────────────────────────────────────

export function translateFixtureQuery(
  q: FixtureQuery,
  queryName?: string,
): TranslatedQuery {
  // Cell ids can contain hyphens; .gq query names are identifiers only.
  const safe = sanitizeQueryName(queryName);
  switch (q.kind) {
    case "nodes":
      return translateNodesQuery(q, safe ?? "ng_nodes");
    case "path":
      return translatePathQuery(q, safe ?? "ng_path");
    case "ego":
      throw new UnsupportedTranslationError(
        "translateFixtureQuery: `ego` is not supported in server mode for v0.7. " +
          "Express the same intent with `kind: path` (one edge type) — multi-edge " +
          "ego will land in v0.8 once the translator can emit unioned queries.",
      );
  }
}

/**
 * `.gq` query names are identifiers (`[a-zA-Z_][a-zA-Z0-9_]*`). Cell ids
 * can have hyphens; we replace them with underscores. Names that don't
 * start with a letter/underscore get a `q_` prefix.
 */
function sanitizeQueryName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  let out = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!/^[a-zA-Z_]/.test(out)) out = "q_" + out;
  return out;
}

// ── translateMutation ─────────────────────────────────────────────────────

/**
 * MutationParams → one `.gq` mutation.
 *
 *   set_field { target_type, field, value, target_id }
 *     →  update <target_type> set { <field>: $value } where id = $target_id
 *
 * Server commits one manifest version per call (atomic).
 */
export function translateMutation(
  params: MutationParams,
  queryName = "ng_mutate",
): TranslatedQuery {
  switch (params.kind) {
    case "set_field": {
      if (!FIELD_PATTERN.test(params.field)) {
        throw new UnsupportedTranslationError(
          `translateMutation: invalid field name '${params.field}'`,
        );
      }
      // v0.7 only supports String-typed values (covers enum + plain text);
      // numeric/boolean field types land alongside richer mutation kinds.
      const decls = `($value: String, $target_id: String)`;
      // The server-side @key field is conventionally named `slug` (Lance
      // reserves `id` for the row-id). Mutations always identify rows by
      // slug; the cell author still writes `target_id` from the row's
      // exposed `id` column (which is projected from `slug`).
      const body =
        `update ${params.target_type} set { ${params.field}: $value } where slug = $target_id`;
      return {
        query_name: queryName,
        query_source: `query ${queryName}${decls} {\n${body}\n}\n`,
        params: { value: params.value, target_id: params.target_id },
      };
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function paramName(
  prefix: string,
  hint: string,
  bag: Record<string, unknown>,
  decls: string[],
  value: unknown,
): string {
  let i = 0;
  let name = `${prefix}_${hint}`;
  while (name in bag) {
    i += 1;
    name = `${prefix}_${hint}_${i}`;
  }
  bag[name] = value;
  decls.push(`$${name}: String`);
  return name;
}

// Make sure `COMP_OPS` is referenced (parking it for future where-op support).
void COMP_OPS;
