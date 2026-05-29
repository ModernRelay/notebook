import { z } from "zod";
import { parse as parseYaml } from "yaml";

/** Data-bearing lenses (cells with a query). */
export const LensKind = z.enum(["Table", "Subgraph", "Path", "ActionList"]);
export type LensKind = z.infer<typeof LensKind>;

/** Interactive controls (cells without a query). */
export const ControlKind = z.enum(["Button", "Toggle", "Select"]);
export type ControlKind = z.infer<typeof ControlKind>;

/** Any cell type. */
export const ComponentKind = z.enum([
  "Table",
  "Subgraph",
  "Path",
  "ActionList",
  "Button",
  "Toggle",
  "Select",
]);
export type ComponentKind = z.infer<typeof ComponentKind>;

/** Element-level action binding (mirrors json-render's shape). */
export const ActionBindingSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type ActionBinding = z.infer<typeof ActionBindingSchema>;

// ── Mutation DSL ──────────────────────────────────────────────────────────
// Declarative atomic mutations dispatched by ActionList per-row buttons.
// The substrate (FixtureSource in dev, omnigraph-server `POST /change` in
// prod) executes one mutation per click. Cell authors declare the shape;
// the lens fills `target_id` from the row at click time.

const SetFieldMutationSchema = z.object({
  kind: z.literal("set_field"),
  /** Defensive: target node type must match before applying the write. */
  target_type: z.string().min(1),
  field: z.string().min(1),
  value: z.unknown(),
});
export type SetFieldMutation = z.infer<typeof SetFieldMutationSchema>;

export const MutationSpecSchema = z.discriminatedUnion("kind", [
  SetFieldMutationSchema,
]);
export type MutationSpec = z.infer<typeof MutationSpecSchema>;

/** What the `mutate` action handler receives — spec + the lens-supplied target_id. */
export const MutationParamsSchema = MutationSpecSchema.and(
  z.object({ target_id: z.string().min(1) }),
);
export type MutationParams = z.infer<typeof MutationParamsSchema>;

/** Reserved for richer reporting later (rows-affected, version, etc). */
export interface MutationResult {
  kind: "ok";
}

// ── Fixture-mode query DSL ────────────────────────────────────────────────
// Used when a notebook declares a top-level `fixture` path. The cell's
// `query.fixture` carries a structured query that the in-memory runner
// evaluates against the loaded JSON graph. See @omnigraph/fixture.

const FixtureNodesQuerySchema = z.object({
  kind: z.literal("nodes"),
  where: z.record(z.string(), z.unknown()).optional(),
  project: z.array(z.string()).optional(),
  order_by: z
    .object({
      field: z.string().min(1),
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .optional(),
  limit: z.number().int().positive().optional(),
});

const FixturePathStepSchema = z.object({
  /** Variable name bound by this step (every step binds its target node). */
  var: z.string().min(1),
  /** Optional type filter on the bound node. */
  type: z.string().min(1).optional(),
  /** Edge type for traversal. Required on every step except the first. */
  edge: z.string().min(1).optional(),
  /**
   * Traversal direction.
   *   - `out` (default): previous step's node is the edge source; this step
   *     binds the edge target.
   *   - `in`: previous step's node is the edge target; this step binds the
   *     edge source. Useful for "Decision ← owned by ← Actor" when `owns`
   *     is defined as Actor → Decision.
   */
  direction: z.enum(["out", "in"]).default("out"),
});

const FixturePathProjectionSchema = z
  .object({
    /** Variable + field reference, e.g. "s.title". Mutually exclusive with literal. */
    var: z.string().min(1).optional(),
    /** Constant string value, useful for predicate labels. */
    literal: z.string().optional(),
    as: z.string().min(1),
  })
  .refine(
    (p) => (p.var !== undefined) !== (p.literal !== undefined),
    "exactly one of `var` or `literal` must be set",
  );

const FixturePathQuerySchema = z.object({
  kind: z.literal("path"),
  steps: z.array(FixturePathStepSchema).min(2),
  project: z.array(FixturePathProjectionSchema).min(1),
});

const FixtureEgoProjectionSchema = z.object({
  /** One of: `center.<field>`, `edge_type`, `edge_direction`, `neighbor.<field>`, `neighbor_type`, `edge.<field>`. */
  var: z.string().min(1),
  as: z.string().min(1),
});

const FixtureEgoQuerySchema = z.object({
  kind: z.literal("ego"),
  center: z.object({
    type: z.string().min(1),
    where: z.record(z.string(), z.unknown()).default({}),
  }),
  out: z.array(z.string().min(1)).default([]),
  in: z.array(z.string().min(1)).default([]),
  project: z.array(FixtureEgoProjectionSchema).min(1),
});

export const FixtureQuerySchema = z.discriminatedUnion("kind", [
  FixtureNodesQuerySchema,
  FixturePathQuerySchema,
  FixtureEgoQuerySchema,
]);
export type FixtureQuery = z.infer<typeof FixtureQuerySchema>;
export type FixtureNodesQuery = z.infer<typeof FixtureNodesQuerySchema>;
export type FixturePathQuery = z.infer<typeof FixturePathQuerySchema>;
export type FixtureEgoQuery = z.infer<typeof FixtureEgoQuerySchema>;

// ── Cell + Notebook ───────────────────────────────────────────────────────

const QuerySchema = z
  .object({
    // .gq mode (server). Deprecated escape hatch; prefer structured
    // `query.fixture` so fixture/server sources can validate parity.
    source: z.string().min(1).optional(),
    name: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    branch: z.string().optional(),
    snapshot: z.string().optional(),
    // Fixture mode — used when notebook declares a top-level `fixture`.
    fixture: FixtureQuerySchema.optional(),
  })
  .refine(
    (q) => !(q.branch && q.snapshot),
    "query.branch and query.snapshot are mutually exclusive",
  )
  .refine(
    (q) => Boolean(q.source) !== Boolean(q.fixture),
    "exactly one of query.source or query.fixture must be set",
  );

/**
 * A control descriptor attached *to* a data cell — the filter Selects /
 * Toggles / Buttons that operate on the cell's data view. Renders inline
 * above the lens; never gets its own cell tab/screen.
 *
 * Shape mirrors a control cell minus `query` (controls don't fetch data;
 * they read/write state via $bindState / on.press → setState).
 */
export const CellControlSchema = z.object({
  id: z.string().min(1).optional(),
  lens: ControlKind,
  props: z.record(z.string(), z.unknown()).default({}),
  on: z.record(z.string().min(1), ActionBindingSchema).optional(),
  visible: z.unknown().optional(),
});
export type CellControl = z.infer<typeof CellControlSchema>;

export const CellSchema = z
  .object({
    id: z.string().min(1),
    lens: ComponentKind,
    /**
     * Required for data lenses (Table/Path/Subgraph/ActionList), absent
     * for top-level control cells (Button/Toggle/Select). Validated by
     * the refinement below.
     */
    query: QuerySchema.optional(),
    props: z.record(z.string(), z.unknown()).default({}),
    /**
     * Inline controls that operate on this cell's data view (filter
     * Selects, Toggles, action Buttons). Rendered above the lens output
     * within the cell's screen — they don't get their own tab.
     */
    controls: z.array(CellControlSchema).optional(),
    /**
     * Element-level action bindings, e.g.
     *   on: { press: { action: approve, params: { id: { $state: "/sel" } } } }
     * Passed verbatim into the json-render spec so the framework can
     * dispatch on emit().
     */
    on: z.record(z.string().min(1), ActionBindingSchema).optional(),
    /**
     * Element-level visibility expression, passed verbatim to json-render.
     * Accepts a boolean, a state-condition object, or an array (AND).
     */
    visible: z.unknown().optional(),
  })
  .refine(
    (c) => {
      const isControl =
        c.lens === "Button" || c.lens === "Toggle" || c.lens === "Select";
      return isControl ? c.query === undefined : c.query !== undefined;
    },
    {
      message:
        "data cells (Table/Path/Subgraph/ActionList) require a `query`; control cells (Button/Toggle/Select) must not have one",
    },
  );
export type Cell = z.infer<typeof CellSchema>;

export const NotebookSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  /** Path to a JSON fixture (relative to the notebook). When set, runs in fixture mode. */
  fixture: z.string().min(1).optional(),
  /** omnigraph-server base URL when running in server mode. CLI flag overrides. */
  server: z.url().optional(),
  cells: z.array(CellSchema),
});
export type Notebook = z.infer<typeof NotebookSchema>;

/** Parse a YAML or JSON string into a validated Notebook. Throws ZodError on failure. */
export function parseNotebook(source: string): Notebook {
  const raw: unknown = parseYaml(source);
  return NotebookSchema.parse(raw);
}
