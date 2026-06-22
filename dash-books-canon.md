# Dash-books — Canon

> The single source of truth for what this project is, how it's built, where it stands, and
> where it's going. Supersedes scattered notes; when this doc and code disagree, fix one of them.

---

## 1. Overall project concept

**Turn an OmniGraph graph into a read-and-act dashboard you describe in one YAML file — rendered from
one typed result contract in a browser and a terminal.**

A "dash-book" is a notebook: a YAML document whose cells are typed **lenses** (`Table`, `Path`,
`Subgraph`, `ActionList`) and **controls** (`Button`, `Toggle`, `Select`). You declare *what slice of
the graph to show and what actions to allow*; you never write UI code. The same YAML drives a
React/Tailwind web renderer and an Ink terminal renderer from one shared result contract. The browser
is the first-class rich renderer; the terminal is a useful degradation over the same data and action
model, not the ceiling on what the browser may express. It is bidirectional: lenses **read** the
graph, controls and actions **write** to it.

### The guiding principle: consistency through server-owned native queries

A dash-book does **not invent queries**. Every cell binds to a **predefined, server-owned query** and
invokes it through the **TypeScript SDK** (`@modernrelay/omnigraph`). That query is native `.gq` with
typed params and a declared result contract. One query definition is shared across the `omnigraph`
CLI, the SDK, and the dash-book — so a dashboard **cannot drift** from canon: a field rename, query
fix, param change, or result-shape change happens once, in the server-owned catalog, and every surface
updates together. The dash-book is a *presentation + interaction layer over canonical queries and
actions*, nothing more.

Two consequences fall out of that principle, and they define the rest of this doc:

1. **No local mock data.** There is no in-memory fixture graph. A dash-book runs against a real
   omnigraph-server (or a local cluster), always through the SDK. *(Fixture mode is deleted — §3.)*
2. **No client-side query generation (target).** The client stops compiling a query DSL into `.gq`;
   it invokes predefined native `.gq` queries by name. Raw inline `.gq` exists only as an explicit,
   capability-gated escape hatch. *(In progress — §4.)*

---

## 2. Key modules

| Package | Role |
|---|---|
| `@modernrelay/notebook-core` | The engine, one package / three modules: **`spec`** (Zod YAML schemas + query model + `parseNotebook`), **`catalog`** (`lensComponents`/`lensActions` + `assembleLensSpec`/`assembleControlSpec`), **`runtime`** (`createNotebookRuntime`: execution, `$state` resolution, dependency invalidation, mutation lifecycle, optimistic reconciliation). The `@json-render/core` analog — start here. |
| `@modernrelay/notebook-client` | **The only data source.** `ServerSource` (implements the runtime `Source` contract) + `Client`, a thin facade over the `@modernrelay/omnigraph` SDK. All graph I/O goes through the SDK — there is no direct HTTP to the graph. |
| `@modernrelay/notebook-tui` | Ink terminal renderer + `omnigraph-tui` bin. |
| `@modernrelay/notebook-web` | Vite + React + Tailwind browser renderer (+ ⌘K palette). |
| `@modernrelay/notebook` (`packages/cli`) | The published front door. Bundles the libs + ships the web SPA. Subcommands: `view` (browser), `tui` (terminal), `validate`/`render`/`catalog`/`schema` (agent-DX, JSON out). |

**Data flow:** `YAML → parseNotebook → createNotebookRuntime → RuntimeSnapshot → Renderer → UI`, with
`ServerSource.read/mutate` (via the SDK) supplying data and `assembleLensSpec` producing the
json-render spec each renderer draws.

**Removed:** `@modernrelay/notebook-fixture` (the in-memory JSON graph source) — see §3.

---

## 3. Current state

- **One renderer engine, two host shells, one source.** core (spec/catalog/runtime) feeds tui and web;
  the only `Source` is `ServerSource` over the SDK.
- **Fixture mode deleted.** No `@modernrelay/notebook-fixture` package, no in-memory mock graph, no
  top-level `notebook.fixture` selection, no example fixtures. A dash-book runs **only against
  omnigraph-server** (a live server or a local cluster from `scripts/server-demo.sh`).
- **SDK-only transport.** `ServerSource → Client → @modernrelay/omnigraph`. The only raw HTTP in the
  repo is the CLI's local static web server + `/og` reverse proxy for `view` — not graph access.
- **0.7 cluster-only.** omnigraph-server 0.7.0+ serves every graph under `/graphs/{graph}/…`, so server
  mode requires a graph id. Connection today is ad-hoc: `--server <URL>` / `--graph` / `--token`
  (+ a few env vars).
- **Interim wart — client still generates queries.** Cells still carry the structured query DSL
  (`query.fixture` = `nodes`/`path`/`ego`), which `ServerSource` compiles to ad-hoc `.gq` via
  `translate.ts` (incl. ego decomposition + identifier-sanitizing regexes) and ships as
  `og.query({ query })`. This is the thing §4 removes. The field is still named `fixture` for
  historical reasons; that rename rides along with the §4 work.

---

## 4. Target shape

The end state realizes the §1 principle through eight architectural choices.

### 4.1 Cells reference native `.gq` catalog queries by name
```yaml
- id: decisions-by-urgency
  lens: Table
  query: { ref: decisions_by_urgency, params: { status: { $state: "/filters/status" } } }
```

- `query.ref` names a server-owned catalog query authored in native `.gq`.
- `ServerSource.read` becomes **`og.queries.invoke(ref, { params, branch, snapshot })`** — the SDK's
  dedicated stored-query path (`POST /queries/{name}`); the source comes from the registry, never the
  cell. This is a *different SDK method* from `og.query({ query })` (the ad-hoc path = §4.2).
- **Param types come from config, available today:** `og.queries.list()` returns each query's typed
  `ParamDescriptor`s (`ParamKind` = string/int/float/bool/date/datetime/bigint/blob/vector/list, plus
  nullability). `notebook validate` checks the `ref` resolves and the cell's params match.
- **Delete the client-side query compiler:** `translate.ts`, the ego decomposition planner, and the
  identifier-sanitization guards all go away. `ServerSource` collapses to a thin SDK caller.
- Retire the `nodes`/`path`/`ego` DSL. The full `.gq` language handles filters, ordering, multi-hop
  traversals, aggregation, and future query features directly.
- `$state` params keep resolving client-side and pass through as typed `params`.

`query.ref` is a contract change, not a field rename — and **not** a new naming problem: the SDK
already separates the paths cleanly (`og.queries.invoke(name)` for registry queries vs
`og.query({ query, name })` for ad-hoc, where the legacy `query.name` only ever selects within an
inline payload). The migration is a vertical slice: Zod accepts `query.ref`; `ReadRequest` carries
`queryRef`; `ServerSource.read` routes `ref` → `og.queries.invoke` and `rawGq` → `og.query`;
capabilities advertise named-query support.

Every query a dash-book runs by default is a **named catalog query**: authored once, lint-validated at
`cluster apply`, Cedar-gated (`invoke_query`), and **identical** to what `omnigraph query <name>` and
any other SDK consumer run. The dashboard is provably a view over canon.

### 4.2 Raw `.gq` is an escape hatch, not the default
Inline query text is useful for local prototyping, debugging, and privileged one-off dashboards, but
it must not become the normal notebook contract:

```yaml
- id: scratch
  lens: Table
  query:
    rawGq: |
      query scratch($status: String) {
        match { $d: Decision { status: $status } }
        return { $d.slug as slug, $d.title as title }
      }
    params: { status: proposed }
```

- `rawGq` is capability-gated and off by default in production/operator contexts.
- Validation warns that raw queries are not canonical catalog queries.
- Raw reads still use native `.gq` and typed params; they do not revive the fixture DSL.

### 4.3 Lenses are dumb views over typed result envelopes
Lenses render `{ result, schema, ctx }` and know nothing about how the query was authored or invoked,
so adding a query feature needs no new lens and adding a visualization needs no query change. Target
envelope shapes: `rows` (tabular), `graph` (nodes/edges), `tree` (nested/traversal-shaped).

**Where the types come from (the 0.7 paradigm) — config, not invention:**
- **Params** — the query catalog (`og.queries.list()` → typed `ParamDescriptor`s). Available now.
- **Field types / enums / nullability** — the `.pg` schema (`og.schema.get()` → `.pg` source).
  `company.pg` already declares `enum(proposed, accepted, …)`, `String?`, `Date`, etc. (No units and
  no display labels in `.pg` today — labels derive from field names; units are absent.)

> **Decision — output types come from config (option a); the type data is never missing.** All type
> information already lives in config: the `.pg` schema (field types, enums, nullability) and the query
> catalog (queries + their params). A notebook is always built with full type knowledge — **we never
> render blind.** The raw HTTP read response happens to be untyped (`ReadOutput` =
> `{ columns: string[], rows: unknown }`), but that is irrelevant: the renderer reads **types from
> config, values from the response.**
>
> So this is not a "missing data" problem — it's a single-source-of-truth choice about *who resolves
> "query → output columns + their types" and where it's published.* The answer is the **server**, which
> already resolves every `return` expression's type when it compiles the query. omnigraph publishes
> those resolved output types in the catalog (`GET /queries`, alongside the params it already exposes),
> so nothing re-derives them. This is a cross-repo dependency on omnigraph-server/SDK; until it ships,
> v1 uses author-declared columns (today's Table-lens model — still config-grounded). Rejected: the
> notebook re-resolving outputs from config itself (duplicates work the server already does), and
> notebook-owned types as the permanent model (breaks single-source).

### 4.4 Two view tiers, with web first-class and TUI degraded
Both tiers draw from a **curated, closed catalog of well-tested components** — the existing
`lensComponents` model, extended deliberately. Authors **compose** from the catalog; they never author
components, and there is no universal UI generator (see §4.9).

- **Auto tier:** given a result envelope plus schema metadata, infer the component. Examples:
  enum → badge/filter, number+unit → formatted metric, date → relative/absolute date, refs → links,
  edges → graph/path view. This should cover most operator dashboards with little or no lens config.
- **Component tier:** a fixed vocabulary of blessed layout + display components for authored views —
  grid, rows, tabs, panels, charts, forms, inputs, markdown, conditional visibility. Each is a vetted,
  tested catalog entry, not a user-authored or runtime-loaded component.

Explicit `lens:` always wins; the auto tier fills in only when a cell omits `lens`. The auto tier
depends on config-declared query outputs (§4.3) — pending that omnigraph feature, v1 leans on explicit
lenses with author-declared columns.

The browser renderer is first-class for the component tier. The TUI renders the same notebook and
actions through best-fit terminal views, especially the auto tier, but TUI parity must not cap the
browser vocabulary.

**Bindings stay declarative, not a language.** Cells bind component props to `$state` pointers, query
params (today's model), and result columns + schema metadata. Display-shaping (format, unit, label) is
component-prop + metadata driven. There is **no** client-side expression/formula language and **no**
control flow — that is the line between a dashboard runtime and a UI framework.

**Extensibility is by contribution, not plugins.** A new component lands as an in-tree, reviewed,
tested PR to the catalog — never as third-party, runtime-loaded, or sandboxed code. Each catalog
component ships a TUI renderer, or falls back to a table.

### 4.5 Writes are server-owned, schema-validated actions — *(Phase 2; v1 is read-only)*
**v1 ships read-only representation** (operating decision): no write path beyond today's interim
`set_field`, and the model below is deferred. When it lands, it mirrors named queries:

- Notebooks call named server-owned mutations/actions by `ref`, with typed params.
- The server validates create/update/delete operations for nodes and edges against the graph schema.
- Writes support multi-field updates and typed values (`string`, `number`, `bool`, `date`, enum,
  ref) inside one branch transaction.
- Inputs (`text`, `number`, `date`, `select`, `ref-picker`, etc.) bind to params, so forms and data
  entry are first-class.
- Writes land on a branch by default, with review/merge affordances matching the branch-not-main
  operating model.

No permanent client-generated `.gq` mutation path: write text belongs in the same server-owned,
authorized catalog as reads.

### 4.6 Runtime dataflow is an explicit dependency DAG
The JSON-pointer state store stays as a simple substrate, but dependency tracking becomes explicit:
inputs, controls, query params, reads, mutations, and cells form a DAG. When an input changes, only
downstream queries (and the cells that render them) re-run. This preserves the current selective
invalidations while making dependencies author-visible and extensible beyond `$state` scans. (No
client-side computed/expression layer — see §4.4.)

### 4.7 Connection aligned with omnigraph 0.7 (RFC-011)
Stop inventing env vars; become a well-behaved operator-config client (server scope):
- Read `~/.omnigraph/config.yaml` — resolve `--server <name|URL>` via `servers:`, pick
  `--profile`/`$OMNIGRAPH_PROFILE`/`defaults` (server + `default_graph`).
- Read `~/.omnigraph/credentials` (0600) with the token chain
  `OMNIGRAPH_TOKEN_<SERVER>` → credentials `[server]` → `OMNIGRAPH_BEARER_TOKEN`.
- Drop the invented `OMNIGRAPH_TOKEN` / `OMNIGRAPH_GRAPH_ID`.
- Result: `notebook view dash.notebook.yaml` works with **zero flags** once you've `omnigraph login`'d —
  same as `omnigraph query`.

CLI, TUI, web, and the SDK facade should not each resolve tokens and graph ids independently. Put the
Node-side operator config + credentials chain in one shared resolver. Browser mode is necessarily
different: credentials should arrive through the `notebook view` same-origin proxy (server-side token
injection) or explicit dev URL config, not by reading operator files.

### 4.8 Dev loop without fixtures
Authoring/iteration runs against a **local cluster** (`scripts/server-demo.sh`) instead of an in-memory
JSON graph. Desirable CLI affordances (independent of the above): `--watch` hot-reload, per-command
`--help`, `--version`, and an `omnigraph-notebook` bin alias so `omnigraph notebook <cmd>` dispatches
here if/when the Rust CLI adopts git-style plugin discovery (the renderer stays in Node).

Fixture deletion should be enforced structurally. The fixture package and examples are gone, but the
notebook schema should reject stale top-level `fixture:` keys instead of silently stripping unknown
fields. Make the schema strict, update tests that still include old fixture fields, and add an explicit
rejection test for removed fixture-mode config. (Internal tool — no external authors to break — so a
strict, single-version schema is safe; no version negotiation or legacy-v1 support is needed.)

### 4.9 Non-goals
- The dash-book is **not** hosted on the server — it stays a client-side artifact. (Queries are
  server-owned; the notebook is not.)
- Rendering stays in **Node** (Ink/React); it is never reimplemented in Rust.
- The dash-book runtime is **not** an arbitrary end-user product UI framework. Concretely:
  - **In:** composing a curated, tested component catalog; components bound to server-owned queries
    and actions; declarative `$state` / param / result bindings; the auto tier.
  - **Out:** user-authored or third-party runtime-loaded components; a client-side expression/formula
    language or control flow; presentation logic not anchored to a catalog query or action.
  - For bespoke product apps, the right direction is scaffolding/generating a normal web app from the
    graph schema, typed query client, and hooks. The notebook remains an operator/dashboard runtime.

---

## Migration ledger
- [x] Consolidate spec + catalog + runtime → `@modernrelay/notebook-core`.
- [x] **Delete fixture mode** (package, top-level selection, example fixtures, source-selection).
**Phase 1 — read-only canon (v1).**
- [x] Cells reference catalog queries by `ref`; `ServerSource.read` → `og.queries.invoke`;
      `ReadRequest.queryRef` plumbing; deleted `translate.ts` read path + the `nodes`/`path`/`ego` DSL.
- [x] `rawGq` escape hatch: capability-gated; validation warns.
- [~] `notebook validate` parses + capability-checks; resolving `ref`/params against the live catalog
      (`og.queries.list()`) is still TODO (needs a reachable server).
- [x] Strict schema; rejects stale fixture-mode keys (internal tool — no version support).
- [x] Operator-config connection client (shared `@modernrelay/notebook-client/node` resolver:
      config.yaml + credentials, named servers, keyed tokens, profiles; browser uses the `view` proxy).
- [x] Render explicit lenses over named queries; web-only components degrade to a table in the TUI.
- [~] CLI DX: `--version`, per-command `--help`, `omnigraph-notebook` bin, `render --watch` done;
      `view`/`tui` live-reload deferred.
- [x] Refresh CLAUDE.md / README.md / AGENTS.md / server-demo to the post-fixture, predefined-query model.
- [ ] End-to-end run against a live omnigraph cluster (`server-demo.sh` — cargo build + `og.queries.invoke`).

**Cross-repo dependency for Phase 2 — declared query outputs (§4.3, decided: option a).** omnigraph
extends the query catalog to declare output columns + types (`GET /queries`), mirroring params. Gates
the auto tier and output-binding validation; until it ships, v1 uses author-declared columns.

**Phase 2 — representation depth.**
- [ ] Typed result envelopes (`rows` / `graph` / `tree`) with schema-derived metadata (pending the decision above).
- [ ] Auto-render tier from result metadata; explicit `lens:` overrides.
- [~] Curated, tested web-first component/layout catalog; TUI best-fit/degraded over the same contract.
      - [x] **2A — layout tier, first primitive.** Cell `display: inline|drawer|modal` + `open_state`
            JSON-pointer: cells sharing a pointer lift into one overlay, open while that pointer is truthy
            (the same `/selected` a Table writes on row click), close clears it. Host-shell only — no
            json-render/spec/runtime change; reuses the selection state + `applyStateChanges`. Web renders
            the drawer/modal (`web/src/layout.ts` `partitionCells` + `components/ui/drawer.tsx`); the TUI is
            layout-flat and renders every cell inline. Lenses (Timeline, Card, wrap, click-to-select) landed
            alongside.
- [ ] Extend the catalog by in-tree, reviewed contribution (no third-party/sandboxed lenses); TUI
      renderer or table fallback per component.
- [ ] Explicit dependency DAG (inputs, controls, query params, reads, cells) — no client expression layer.

**Phase 3 — writes (deferred).**
- [ ] Named server-owned mutations/actions by `ref`, typed inputs/forms, schema validation, branch
      transactions, review/merge.
