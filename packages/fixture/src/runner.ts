import type {
  FixtureQuery,
  FixtureNodesQuery,
  FixturePathQuery,
  FixtureEgoQuery,
} from "@modernrelay/notebook-core";
import type { Fixture, FixtureNode, FixtureEdge } from "./validator.js";

export type ResultRow = Record<string, unknown>;

export interface QueryResult {
  columns: string[];
  rows: ResultRow[];
}

/**
 * Run a structured fixture query against the in-memory graph. Pure: takes
 * the query + fixture, returns rows. No I/O, no async.
 */
export function runFixtureQuery(
  query: FixtureQuery,
  fixture: Fixture,
): QueryResult {
  switch (query.kind) {
    case "nodes":
      return runNodes(query, fixture);
    case "path":
      return runPath(query, fixture);
    case "ego":
      return runEgo(query, fixture);
  }
}

// ── nodes ────────────────────────────────────────────────────────────────

function runNodes(q: FixtureNodesQuery, fix: Fixture): QueryResult {
  let rows: FixtureNode[] = fix.nodes.filter((n) => matchesWhere(n, q.where));

  if (q.order_by) {
    const { field, direction } = q.order_by;
    rows = [...rows].sort((a, b) =>
      compareValues(a[field], b[field], direction),
    );
  }
  if (q.limit !== undefined) {
    rows = rows.slice(0, q.limit);
  }

  const columns = q.project ?? inferColumns(rows);
  const projected: ResultRow[] = rows.map((node) => {
    const out: ResultRow = {};
    for (const key of columns) out[key] = node[key];
    return out;
  });
  return { columns, rows: projected };
}

// ── path ─────────────────────────────────────────────────────────────────

function runPath(q: FixturePathQuery, fix: Fixture): QueryResult {
  const [start, ...rest] = q.steps;
  if (!start) throw new Error("path query requires at least one step");

  // Each binding is a Map<varName, FixtureNode> representing a candidate row.
  let bindings: Map<string, FixtureNode>[] = fix.nodes
    .filter((n) => start.type === undefined || n.type === start.type)
    .map((n) => new Map([[start.var, n]]));

  for (const step of rest) {
    if (!step.edge) {
      throw new Error(
        `path step '${step.var}' is not the first step and must declare an edge`,
      );
    }
    const direction = step.direction ?? "out";
    const next: Map<string, FixtureNode>[] = [];
    for (const binding of bindings) {
      const sourceVar = previousVar(q.steps, step);
      const anchor = binding.get(sourceVar);
      if (!anchor) continue;
      const matches = fix.edges.filter((e) => {
        if (e.type !== step.edge) return false;
        return direction === "out" ? e.from === anchor.id : e.to === anchor.id;
      });
      for (const edge of matches) {
        const targetId = direction === "out" ? edge.to : edge.from;
        const target = fix.nodes.find((n) => n.id === targetId);
        if (!target) continue;
        if (step.type !== undefined && target.type !== step.type) continue;
        const extended = new Map(binding);
        extended.set(step.var, target);
        next.push(extended);
      }
    }
    bindings = next;
  }

  const columns = q.project.map((p) => p.as);
  const rows: ResultRow[] = bindings.map((binding) => {
    const row: ResultRow = {};
    for (const proj of q.project) {
      if (proj.literal !== undefined) {
        row[proj.as] = proj.literal;
      } else if (proj.var !== undefined) {
        row[proj.as] = resolveVarRef(proj.var, binding);
      }
    }
    return row;
  });
  return { columns, rows };
}

function previousVar(
  steps: FixturePathQuery["steps"],
  current: FixturePathQuery["steps"][number],
): string {
  const idx = steps.indexOf(current);
  const prev = steps[idx - 1];
  if (!prev) {
    throw new Error("path step has no previous step (internal invariant)");
  }
  return prev.var;
}

// ── ego ──────────────────────────────────────────────────────────────────

function runEgo(q: FixtureEgoQuery, fix: Fixture): QueryResult {
  const centers = fix.nodes.filter(
    (n) => n.type === q.center.type && matchesWhere(n, q.center.where),
  );

  const columns = q.project.map((p) => p.as);
  const rows: ResultRow[] = [];

  for (const center of centers) {
    const incident: Array<{
      edge: FixtureEdge;
      neighbor: FixtureNode;
      direction: "out" | "in";
    }> = [];

    if (q.out.length > 0) {
      for (const edge of fix.edges) {
        if (edge.from !== center.id) continue;
        if (!q.out.includes(edge.type)) continue;
        const neighbor = fix.nodes.find((n) => n.id === edge.to);
        if (neighbor) incident.push({ edge, neighbor, direction: "out" });
      }
    }
    if (q.in.length > 0) {
      for (const edge of fix.edges) {
        if (edge.to !== center.id) continue;
        if (!q.in.includes(edge.type)) continue;
        const neighbor = fix.nodes.find((n) => n.id === edge.from);
        if (neighbor) incident.push({ edge, neighbor, direction: "in" });
      }
    }

    for (const { edge, neighbor, direction } of incident) {
      const row: ResultRow = {};
      for (const proj of q.project) {
        row[proj.as] = resolveEgoRef(proj.var, {
          center,
          edge,
          neighbor,
          direction,
        });
      }
      rows.push(row);
    }

    // If the center has no incident edges but the user asked for some,
    // emit one bare-center row so the lens can show the focal node.
    if (incident.length === 0 && (q.out.length > 0 || q.in.length > 0)) {
      const row: ResultRow = {};
      for (const proj of q.project) {
        row[proj.as] = resolveEgoRef(proj.var, {
          center,
          edge: undefined,
          neighbor: undefined,
          direction: undefined,
        });
      }
      rows.push(row);
    }
  }

  return { columns, rows };
}

// ── helpers ──────────────────────────────────────────────────────────────

function matchesWhere(
  node: FixtureNode,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (node[key] !== expected) return false;
  }
  return true;
}

function resolveVarRef(
  ref: string,
  binding: Map<string, FixtureNode>,
): unknown {
  // Forms: "x" → bound node id; "x.field" → property access
  const dot = ref.indexOf(".");
  if (dot < 0) {
    const node = binding.get(ref);
    return node?.id ?? null;
  }
  const varName = ref.slice(0, dot);
  const field = ref.slice(dot + 1);
  const node = binding.get(varName);
  if (!node) return null;
  return node[field] ?? null;
}

function resolveEgoRef(
  ref: string,
  ctx: {
    center: FixtureNode;
    edge: FixtureEdge | undefined;
    neighbor: FixtureNode | undefined;
    direction: "out" | "in" | undefined;
  },
): unknown {
  if (ref === "edge_type") return ctx.edge?.type ?? null;
  if (ref === "edge_direction") return ctx.direction ?? null;
  if (ref === "neighbor_type") return ctx.neighbor?.type ?? null;
  if (ref.startsWith("center.")) {
    return ctx.center[ref.slice("center.".length)] ?? null;
  }
  if (ref.startsWith("neighbor.")) {
    return ctx.neighbor?.[ref.slice("neighbor.".length)] ?? null;
  }
  if (ref.startsWith("edge.")) {
    return ctx.edge?.[ref.slice("edge.".length)] ?? null;
  }
  return null;
}

function compareValues(
  a: unknown,
  b: unknown,
  direction: "asc" | "desc",
): number {
  const av = a ?? "";
  const bv = b ?? "";
  let cmp: number;
  if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return direction === "asc" ? cmp : -cmp;
}

function inferColumns(rows: FixtureNode[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) set.add(key);
  }
  return [...set];
}
