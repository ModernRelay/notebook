import { z } from "zod";
import { parse as parseYaml } from "yaml";

/** Data-bearing lenses (cells with a query). */
export const LensKind = z.enum([
  "Table",
  "Subgraph",
  "Path",
  "ActionList",
  "Timeline",
  "Card",
  "Quote",
]);
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
  "Timeline",
  "Card",
  "Quote",
  "Button",
  "Toggle",
  "Select",
]);
export type ComponentKind = z.infer<typeof ComponentKind>;

/** Element-level action binding (mirrors json-render's shape). */
export const ActionBindingSchema = z
  .object({
    action: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ActionBinding = z.infer<typeof ActionBindingSchema>;

// ── Mutation DSL ──────────────────────────────────────────────────────────
// Declarative atomic mutations dispatched by ActionList per-row buttons.
// The substrate (omnigraph-server `POST /change`, via the SDK) executes one
// mutation per click. Cell authors declare the shape;
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

// ── Cell + Notebook ───────────────────────────────────────────────────────

const QuerySchema = z
  .object({
    /**
     * Reference to a server-owned catalog query, invoked by name via the SDK's
     * stored-query path (`og.queries.invoke`). The canonical, default path —
     * the query body lives in the cluster catalog, never in the notebook.
     */
    ref: z.string().min(1).optional(),
    /**
     * Raw `.gq` source — a capability-gated escape hatch for prototyping,
     * debugging, and privileged one-offs. NOT the canonical contract; prefer
     * `ref`. Sent ad-hoc via `og.query`. See dash-books-canon.md §4.2.
     */
    rawGq: z.string().min(1).optional(),
    /** Selects a query within a multi-query `rawGq` payload. */
    name: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    branch: z.string().optional(),
    snapshot: z.string().optional(),
  })
  .strict()
  .refine(
    (q) => !(q.branch && q.snapshot),
    "query.branch and query.snapshot are mutually exclusive",
  )
  .refine(
    (q) => Boolean(q.ref) !== Boolean(q.rawGq),
    "exactly one of query.ref or query.rawGq must be set",
  );

/**
 * A control descriptor attached *to* a data cell — the filter Selects /
 * Toggles / Buttons that operate on the cell's data view. Renders inline
 * above the lens; never gets its own cell tab/screen.
 *
 * Shape mirrors a control cell minus `query` (controls don't fetch data;
 * they read/write state via $bindState / on.press → setState).
 */
export const CellControlSchema = z
  .object({
    id: z.string().min(1).optional(),
    lens: ControlKind,
    props: z.record(z.string(), z.unknown()).default({}),
    on: z.record(z.string().min(1), ActionBindingSchema).optional(),
    visible: z.unknown().optional(),
  })
  .strict();
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
    /**
     * Presentation mode (host-shell layout tier, web-first). `inline` (default)
     * stacks the cell in flow; `drawer`/`modal` render it in an overlay that is
     * open while `open_state` is truthy. The TUI ignores this and renders inline.
     */
    display: z.enum(["inline", "drawer", "modal"]).optional(),
    /**
     * JSON-pointer whose truthy value opens this cell's overlay (with `display:
     * drawer|modal`). Cells sharing an `open_state` render in one overlay; the
     * close affordance clears this pointer. Typically the selection pointer a
     * Table writes via `select_state` (e.g. "/selected").
     */
    open_state: z.string().optional(),
    /**
     * In-flow layout width (host-shell layout tier, web-first). The web host
     * arranges inline cells in a responsive 6-column grid; this sets the cell's
     * column span — `full` (default, own row), `two-thirds`, `half`, `third`.
     * Cells flow left-to-right and wrap. The TUI ignores this (one cell per tab).
     */
    width: z.enum(["full", "half", "third", "two-thirds"]).optional(),
  })
  .strict()
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

export const NotebookSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1),
    /** omnigraph-server base URL (or operator-config server name). CLI/URL flags override. */
    server: z.string().min(1).optional(),
    /**
     * Cluster graph id for server mode. omnigraph-server 0.7.0+ is cluster-only:
     * reads/writes are served under `/graphs/{graph}/…`. Required in server mode;
     * `--graph` (TUI/CLI) or `?graph=` (web) override it.
     */
    graph: z.string().min(1).optional(),
    cells: z.array(CellSchema),
  })
  .strict();
export type Notebook = z.infer<typeof NotebookSchema>;

/** Parse a YAML or JSON string into a validated Notebook. Throws ZodError on failure. */
export function parseNotebook(source: string): Notebook {
  const raw: unknown = parseYaml(source);
  return NotebookSchema.parse(raw);
}
