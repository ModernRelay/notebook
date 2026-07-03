import { z } from "zod";
import { parse as parseYaml } from "yaml";

/** Data-bearing lenses (cells with a query; Form's query is optional — prefill). */
export const LensKind = z.enum([
  "Table",
  "Subgraph",
  "Path",
  "ActionList",
  "Timeline",
  "Card",
  "Quote",
  "Text",
  "Form",
]);
export type LensKind = z.infer<typeof LensKind>;

/** Interactive controls (cells without a query). */
export const ControlKind = z.enum([
  "Button",
  "Toggle",
  "Select",
  "TextInput",
  "NumberInput",
]);
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
  "Text",
  "Form",
  "Button",
  "Toggle",
  "Select",
  "TextInput",
  "NumberInput",
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
// A cell action's mutation mirrors the cell `query` shape: `ref` (a server-
// owned catalog mutation, invoked by name) XOR `rawGq` (author-written inline
// `.gq`, a capability-gated escape hatch), plus typed `params` and an optional
// optimistic overlay. The client never constructs a write predicate — identity
// is just a typed param resolved from the clicked row (`$row`) or notebook
// state (`$state`). See dash-books-canon.md §4.5.

/** Optional local overlay applied to the clicked row while the write is in flight. */
const OptimisticSpecSchema = z
  .object({ set: z.record(z.string().min(1), z.unknown()) })
  .strict();
export type OptimisticSpec = z.infer<typeof OptimisticSpecSchema>;

export const MutationSpecSchema = z
  .object({
    /** Server-owned catalog mutation name (its catalog entry has `mutation === true`). */
    ref: z.string().min(1).optional(),
    /** Author-written inline `.gq` mutation — capability-gated escape hatch. */
    rawGq: z.string().min(1).optional(),
    /** Selects a mutation within a multi-query `rawGq` payload. */
    name: z.string().optional(),
    /**
     * Typed params for the mutation. Each value is a literal, a clicked-row
     * column ref `{ $row: "<col>" }`, a state ref `{ $state: "/ptr" }`, or —
     * inside a Form field — a submitted-value ref `{ $input: "<field>" }`.
     */
    params: z.record(z.string(), z.unknown()).optional(),
    optimistic: OptimisticSpecSchema.optional(),
    /**
     * Catalog READ-query refs whose cells this mutation stales. After a
     * successful dispatch the runtime re-reads ONLY cells whose `query.ref`
     * is in the union of the dispatched mutations' `invalidates` (plus the
     * originating cell). Absent ⇒ conservative re-read of every data cell.
     * `[]` ⇒ originating cell only.
     */
    invalidates: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine(
    (m) => Boolean(m.ref) !== Boolean(m.rawGq),
    "exactly one of mutation.ref or mutation.rawGq must be set",
  );
export type MutationSpec = z.infer<typeof MutationSpecSchema>;

/**
 * What the `mutate` action handler receives. An ActionList row button supplies
 * the clicked `row` (source of `$row` params + the optimistic overlay base) and
 * `rowKey` (the row's `id_column` value — the overlay key, NOT a graph id). A
 * non-row trigger (a `Button` with a `mutation`) passes only `spec`; its params
 * resolve from `$state`/literal, and there is no per-row optimistic overlay.
 */
export const MutationParamsSchema = z.object({
  spec: MutationSpecSchema,
  row: z.record(z.string(), z.unknown()).optional(),
  rowKey: z.string().min(1).optional(),
});
export type MutationParams = z.infer<typeof MutationParamsSchema>;

/**
 * A Form submit: the dirty fields' mutations, dispatched by the runtime
 * sequentially as independent server commits (there is no server-side batch
 * transaction) with one saving flag and ONE final re-read. `input` is the
 * full submitted field-value map — `{ $input: "<field>" }` params resolve
 * against it, so a field's mutation may also reference sibling fields.
 * `row` is the prefill row being edited — `{ $row: "<col>" }` identity
 * params resolve against it at dispatch (renderer prop resolution passes
 * `$row`/`$input` through untouched, unlike `{ $state }`, which resolves at
 * render time and silently drops a `default`).
 */
export const MutationBatchParamsSchema = z.object({
  mutations: z.array(z.object({ spec: MutationSpecSchema }).strict()).min(1),
  input: z.record(z.string(), z.unknown()),
  row: z.record(z.string(), z.unknown()).optional(),
});
export type MutationBatchParams = z.infer<typeof MutationBatchParamsSchema>;

/** What the `mutate` action accepts: one mutation, or a Form's dirty batch. */
export const MutationDispatchSchema = z.union([
  MutationParamsSchema,
  MutationBatchParamsSchema,
]);
export type MutationDispatch = z.infer<typeof MutationDispatchSchema>;

/** What a successful mutation reports back. */
export interface MutationResult {
  kind: "ok";
  /**
   * Rows the server reports as touched (ChangeOutput.affected_nodes/_edges).
   * Absent ⇒ the source can't count: no-op detection is skipped and the
   * success feedback says just "Saved".
   */
  affected?: { nodes: number; edges: number };
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
     * Required for data lenses (Table/Path/Subgraph/ActionList), optional
     * on Form (query → edit-form prefill; none → blank create-form), absent
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
     * In-flow layout width (host-shell layout tier, web-first). The web host
     * arranges cells in a responsive 6-column canvas grid; this sets the cell's
     * column span — `full` (default, own row), `two-thirds`, `half`, `third`.
     * Cells flow left-to-right and wrap. The TUI ignores this (one cell per tab).
     */
    width: z.enum(["full", "half", "third", "two-thirds"]).optional(),
    /**
     * Tab this cell belongs to (host-shell view tier). Cells are one flat list
     * sharing one runtime + state; `tab` partitions them into named pages in the
     * shell. The tab bar lists the distinct `tab` values in declaration order;
     * cells with no `tab` fall into a leading default tab. With no `tab` anywhere
     * the notebook renders as a single canvas (today's behavior). State is shared
     * across tabs, so a selection on one tab drives dependent cells on another.
     */
    tab: z.string().min(1).optional(),
    /**
     * Per-card background tint (host-shell appearance tier). A fixed palette of
     * neutral grayscale + a few accents; absent = the default card surface. The
     * web host applies it as a `--card` override on the cell; a browser-local
     * Edit-mode picker can override it per-browser. The TUI ignores it.
     */
    color: z
      .enum(["slate", "zinc", "stone", "blue", "emerald", "amber", "rose", "violet"])
      .optional(),
    /**
     * Initial card height (host-shell appearance tier). The web canvas is a
     * react-grid-layout grid with explicit heights; this sets the starting row
     * span — `short`/`medium`/`tall` — else a per-lens default applies. Content
     * taller than the box scrolls inside the card; a drag-resize override
     * persists per-browser. The TUI ignores it.
     */
    height: z.enum(["short", "medium", "tall"]).optional(),
  })
  .strict()
  .refine(
    (c) => {
      const isControl = (ControlKind.options as readonly string[]).includes(
        c.lens,
      );
      if (isControl) return c.query === undefined;
      // A Form's query is optional: present → edit-form prefilled from the
      // first result row; absent → blank create-form.
      if (c.lens === "Form") return true;
      return c.query !== undefined;
    },
    {
      message:
        "data cells (Table/Path/Subgraph/ActionList/…) require a `query` (optional on Form); control cells (Button/Toggle/Select/TextInput/NumberInput) must not have one",
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
