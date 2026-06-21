/**
 * `ServerSource` is the runtime Source backed by omnigraph-server.
 *
 * Structured notebook queries are translated into `.gq` reads. Raw `.gq`
 * remains available as a deprecated server-only escape hatch.
 */

import type {
  ExecutionContext,
  MutationCommand,
  MutationContext,
  ReadOutput as RuntimeReadOutput,
  ReadRequest,
  Source,
  SourceCapabilities,
} from "@modernrelay/notebook-core";
import type { FixtureEgoQuery, MutationResult } from "@modernrelay/notebook-core";
import { Client, type ChangeOutput } from "./http.js";
import {
  edgeToPredicate,
  translateFixtureQuery,
  translateMutation,
  UnsupportedTranslationError,
  type TranslatedQuery,
} from "./translate.js";

export interface ServerSourceOptions {
  /** Default branch for reads + writes. CLI flag and notebook field win over this. */
  branch?: string;
}

export class ServerSource implements Source {
  constructor(
    private readonly client: Client,
    private readonly opts: ServerSourceOptions = {},
  ) {}

  capabilities(): SourceCapabilities {
    return {
      structuredQueryKinds: ["nodes", "path", "ego"],
      rawGq: true,
      mutationKinds: ["set_field"],
      branchReads: true,
      snapshotReads: true,
      branchWrites: true,
    };
  }

  async read(
    input: ReadRequest,
    context: ExecutionContext,
  ): Promise<RuntimeReadOutput> {
    if (!input.fixtureQuery) {
      if (input.querySource === undefined) {
        throw new Error(
          "ServerSource.read: cell has no fixtureQuery and no querySource",
        );
      }
      return this.client.query(
        {
          query: input.querySource,
          ...(input.queryName !== undefined && { name: input.queryName }),
          ...(input.params !== undefined && { params: input.params }),
          ...this.targetTriple(input),
        },
        context.signal,
      );
    }

    if (input.fixtureQuery.kind === "ego") {
      return this.readEgo(input.fixtureQuery, input, context);
    }

    const translated = translateFixtureQuery(
      input.fixtureQuery,
      input.cellId ?? "ng",
    );
    const params = mergeParams(translated.params, input.params);
    return this.client.query(
      {
        query: translated.query_source,
        name: translated.query_name,
        params,
        ...this.targetTriple(input),
      },
      context.signal,
    );
  }

  async mutate(
    command: MutationCommand,
    context: MutationContext,
  ): Promise<MutationResult> {
    const translated = translateMutation(command.params, "ng_mutate");
    const branch = context.writeTarget.branch ?? this.opts.branch;
    const result: ChangeOutput = await this.client.mutate(
      {
        query: translated.query_source,
        name: translated.query_name,
        params: translated.params,
        ...(branch !== undefined && { branch }),
      },
      context.signal,
    );
    void result;
    return { kind: "ok" };
  }

  private async readEgo(
    query: FixtureEgoQuery,
    input: ReadRequest,
    context: ExecutionContext,
  ): Promise<RuntimeReadOutput> {
    const plan = translateEgoQuery(query, sanitizeQueryName(input.cellId));
    const target = this.targetTriple(input);
    // Center + every incident read are mutually independent: each incident
    // query re-binds the center via its own where-clause, and the center read
    // is only consumed at merge time. So fire them all concurrently rather
    // than serially — collapses (k+1) round-trips into ~1. (Same uncapped
    // Promise.all fan-out the runtime uses across cells.)
    const runRead = (q: TranslatedQuery) =>
      this.client.query(
        {
          query: q.query_source,
          name: q.query_name,
          params: mergeParams(q.params, input.params),
          ...target,
        },
        context.signal,
      );

    const [center, ...incidentResults] = await Promise.all([
      runRead(plan.center),
      ...plan.incident.map((part) => runRead(part.query)),
    ]);

    if (query.out.length === 0 && query.in.length === 0) {
      return {
        query_name: input.queryName ?? plan.name,
        target: center.target,
        row_count: 0,
        columns: query.project.map((projection) => projection.as),
        rows: [],
      };
    }

    const incidentRows = incidentResults.flatMap((result) => result.rows);

    const incidentCenterIds = new Set(
      incidentRows
        .map((row) => row[INTERNAL_CENTER_ID])
        .filter((value): value is string => typeof value === "string"),
    );
    const finalRows = incidentRows.map(stripInternalColumns);
    for (const centerRow of center.rows) {
      const centerId = centerRow[INTERNAL_CENTER_ID];
      if (typeof centerId === "string" && incidentCenterIds.has(centerId)) {
        continue;
      }
      finalRows.push(bareEgoRow(query, centerRow));
    }

    return {
      query_name: input.queryName ?? plan.name,
      target: center.target,
      row_count: finalRows.length,
      columns: query.project.map((projection) => projection.as),
      rows: finalRows,
    };
  }

  private targetTriple(input: ReadRequest): {
    branch?: string;
    snapshot?: string;
  } {
    const branch = input.branch ?? this.opts.branch;
    if (input.snapshot !== undefined) return { snapshot: input.snapshot };
    if (branch !== undefined) return { branch };
    return {};
  }
}

function mergeParams(
  base: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!extra || Object.keys(extra).length === 0) return base;
  return { ...base, ...extra };
}

const FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const TYPE_PATTERN = /^[A-Z][a-zA-Z0-9_]*$/;
const INTERNAL_CENTER_ID = "__ng_center_id";

interface EgoReadPlan {
  name: string;
  center: TranslatedQuery;
  incident: Array<{ direction: "out" | "in"; edge: string; query: TranslatedQuery }>;
}

function translateEgoQuery(query: FixtureEgoQuery, queryName: string): EgoReadPlan {
  if (!TYPE_PATTERN.test(query.center.type)) {
    throw new UnsupportedTranslationError(
      `translateEgoQuery: invalid center type '${query.center.type}'`,
    );
  }

  const name = queryName || "ng_ego";
  const center = translateEgoCenterQuery(query, `${name}_center`);
  const incident: EgoReadPlan["incident"] = [];

  for (const edge of query.out) {
    incident.push({
      direction: "out",
      edge,
      query: translateEgoIncidentQuery(
        query,
        "out",
        edge,
        sanitizeQueryName(`${name}_out_${edge}`),
      ),
    });
  }
  for (const edge of query.in) {
    incident.push({
      direction: "in",
      edge,
      query: translateEgoIncidentQuery(
        query,
        "in",
        edge,
        sanitizeQueryName(`${name}_in_${edge}`),
      ),
    });
  }

  return { name, center, incident };
}

function translateEgoCenterQuery(
  query: FixtureEgoQuery,
  queryName: string,
): TranslatedQuery {
  const params: Record<string, unknown> = {};
  const paramDecls: string[] = [];
  const centerMatch = centerBinding(query, params, paramDecls);
  const returnParts = [
    ...query.project
      .filter((projection) => projection.var.startsWith("center."))
      .map((projection) => {
        const field = fieldRef(projection.var, "center");
        return `$c.${field} as ${projection.as}`;
      }),
    `$c.slug as ${INTERNAL_CENTER_ID}`,
  ];
  const decls = paramDecls.length > 0 ? `(${paramDecls.join(", ")})` : "()";
  return {
    query_name: queryName,
    query_source:
      `query ${queryName}${decls} {\n` +
      `match {\n  ${centerMatch}\n}\n` +
      `return { ${returnParts.join(", ")} }\n` +
      `}\n`,
    params,
  };
}

function translateEgoIncidentQuery(
  query: FixtureEgoQuery,
  direction: "out" | "in",
  edge: string,
  queryName: string,
): TranslatedQuery {
  const params: Record<string, unknown> = {};
  const paramDecls: string[] = [];
  const centerMatch = centerBinding(query, params, paramDecls);
  const predicate = edgeToPredicate(edge);
  if (!FIELD_PATTERN.test(predicate)) {
    throw new UnsupportedTranslationError(
      `translateEgoQuery: invalid edge name '${edge}'`,
    );
  }
  const traversal =
    direction === "out" ? `$c ${predicate} $n` : `$n ${predicate} $c`;
  const returnParts = [
    ...query.project.map((projection) =>
      egoProjectionExpr(projection.var, projection.as, direction, edge),
    ),
    `$c.slug as ${INTERNAL_CENTER_ID}`,
  ];
  const decls = paramDecls.length > 0 ? `(${paramDecls.join(", ")})` : "()";
  return {
    query_name: queryName,
    query_source:
      `query ${queryName}${decls} {\n` +
      `match {\n  ${centerMatch}\n  ${traversal}\n}\n` +
      `return { ${returnParts.join(", ")} }\n` +
      `}\n`,
    params,
  };
}

function centerBinding(
  query: FixtureEgoQuery,
  params: Record<string, unknown>,
  paramDecls: string[],
): string {
  const matches: string[] = [];
  for (const [field, value] of Object.entries(query.center.where)) {
    if (!FIELD_PATTERN.test(field)) {
      throw new UnsupportedTranslationError(
        `translateEgoQuery: invalid center field '${field}'`,
      );
    }
    const param = uniqueParam(`w_${field}`, params, paramDecls, value);
    matches.push(`${field}: $${param}`);
  }
  const props = matches.length > 0 ? ` { ${matches.join(", ")} }` : "";
  return `$c: ${query.center.type}${props}`;
}

function egoProjectionExpr(
  ref: string,
  alias: string,
  direction: "out" | "in",
  edge: string,
): string {
  if (!FIELD_PATTERN.test(alias)) {
    throw new UnsupportedTranslationError(
      `translateEgoQuery: invalid projection alias '${alias}'`,
    );
  }
  if (ref.startsWith("center.")) return `$c.${fieldRef(ref, "center")} as ${alias}`;
  if (ref.startsWith("neighbor.")) return `$n.${fieldRef(ref, "neighbor")} as ${alias}`;
  if (ref === "edge_type") return `${JSON.stringify(edge)} as ${alias}`;
  if (ref === "edge_direction") return `${JSON.stringify(direction)} as ${alias}`;
  if (ref === "neighbor_type" || ref.startsWith("edge.")) {
    throw new UnsupportedTranslationError(
      `translateEgoQuery: projection '${ref}' is not supported in server mode`,
    );
  }
  throw new UnsupportedTranslationError(
    `translateEgoQuery: invalid projection '${ref}'`,
  );
}

function fieldRef(ref: string, prefix: "center" | "neighbor"): string {
  const field = ref.slice(prefix.length + 1);
  if (!FIELD_PATTERN.test(field)) {
    throw new UnsupportedTranslationError(
      `translateEgoQuery: invalid field reference '${ref}'`,
    );
  }
  return field;
}

function uniqueParam(
  hint: string,
  params: Record<string, unknown>,
  decls: string[],
  value: unknown,
): string {
  let name = hint.replace(/[^a-zA-Z0-9_]/g, "_");
  let i = 0;
  while (name in params) {
    i += 1;
    name = `${hint}_${i}`;
  }
  params[name] = value;
  decls.push(`$${name}: String`);
  return name;
}

function sanitizeQueryName(name: string | undefined): string {
  if (!name) return "ng_ego";
  let out = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!/^[a-zA-Z_]/.test(out)) out = "q_" + out;
  return out;
}

function stripInternalColumns(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...row };
  delete out[INTERNAL_CENTER_ID];
  return out;
}

function bareEgoRow(
  query: FixtureEgoQuery,
  centerRow: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const projection of query.project) {
    if (projection.var.startsWith("center.")) {
      out[projection.as] = centerRow[projection.as] ?? null;
    } else {
      out[projection.as] = null;
    }
  }
  return out;
}
