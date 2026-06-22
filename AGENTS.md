# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What it's for

Turn an OmniGraph graph database into a **read-and-act dashboard you describe in one YAML file** — rendered identically in a terminal and a browser.

Normally you inspect a graph by writing queries and reading JSON, or by building a bespoke UI. A notebook is the layer between: a YAML file that *declares what slices of the graph to show and what actions to allow*, not code. Each cell is a typed lens (`Table`/`Path`/`Subgraph`/`ActionList`) fed by a structured query, or a control (`Select`/`Toggle`/`Button`) that filters state or mutates the graph. See `examples/company-server.notebook.yaml`: a status filter, a decisions table, a `Signal → Decision → Actor` path, an ego subgraph, and a clause list with inline Approve/Reject buttons — no UI code anywhere.

Two bets make it work:

- **Typed lenses, not a generic graph viewer** — you name the view you want; the system renders it.
- **Write once, render anywhere** — the same YAML drives the Ink terminal UI and the React web UI, against a live omnigraph-server (a local cluster in dev, a remote server in prod). It's bidirectional: lenses read the graph, controls and actions write back to it.

## Commands

This is a pnpm workspace (pnpm 10.30.3, Node ≥20). All scripts run from the repo root unless noted.

```bash
pnpm install                                     # install workspace deps
pnpm -r build                                    # tsc-build every package — REQUIRED before tui/web run
pnpm -r typecheck                                # tsc --noEmit across all packages
pnpm -r test                                     # vitest run across all packages

pnpm --filter @modernrelay/notebook-<pkg> build             # rebuild one package
pnpm --filter @modernrelay/notebook-<pkg> test              # vitest run for one package
pnpm --filter @modernrelay/notebook-<pkg> test -- <pattern> # single test file/name

pnpm tui examples/company-server.notebook.yaml   # Ink TUI, server mode — server URL + graph id
                                                 #   come from the notebook (run server-demo.sh first)
pnpm --filter @modernrelay/notebook-web dev                 # Vite dev server at 127.0.0.1:5173
                                                 #   add ?mode=server&server=/og (same-origin proxy)
pnpm --filter @modernrelay/notebook-web build               # tsc + vite production build

scripts/server-demo.sh                           # build omnigraph v0.7.0 CLI/server, boot a local
                                                 #   filesystem cluster (graph "company") on :8080
```

The TUI consumes built `dist/` from sibling workspace packages — **always run `pnpm -r build` after editing a non-TUI/non-web package** before running `pnpm tui`. Web's Vite bundles via TS sources directly, but `tsc --noEmit` (`pnpm -r typecheck`) is what enforces cross-package types.

## Architecture

**One catalog, two renderers, one server-backed runtime.** A notebook is YAML; each cell renders as a typed lens (`Table`/`Path`/`Subgraph`/`ActionList`) or a control (`Button`/`Toggle`/`Select`). Both the Ink TUI and the React Web app share the same catalog of component definitions and the same runtime; only the leaf component implementations and the host shell differ.

### Package map

| Package | Role |
|---|---|
| `@modernrelay/notebook-core` | The engine — start here. One package, three internal modules: `spec` (Zod schemas + YAML parser, query model — `ref`/`rawGq` — mutation specs), `catalog` (component+action definitions shared by both renderers; `assembleLensSpec` / `assembleControlSpec` produce json-render specs), `runtime` (capability-aware execution, state mirror, dependency invalidation, action dispatch, mutation lifecycle, optimistic reconciliation). The `@json-render/core` analog. |
| `@modernrelay/notebook-client` | **The only data source.** `ServerSource` + `translate` (structured DSL → `.gq`) + a `Client` facade over the `@modernrelay/omnigraph` SDK (`/query` + `/mutate`, graph-scoped). |
| `@modernrelay/notebook-tui` | Ink renderer + CLI entry (`bin/omnigraph-tui.js`); host shell for terminal. |
| `@modernrelay/notebook-web` | Vite + React + Tailwind renderer; host shell for browser. |
| `@modernrelay/notebook` (`packages/cli`) | The published front-door CLI. Bundles every `@modernrelay/notebook-*` lib (tsup, `noExternal`) and ships the built web SPA in `web-dist/`. Subcommands: `view` (browser — static server + `/og` BFF proxy with server-side token injection, reusing `web/src/config.ts`'s URL-param contract), `tui` (calls `@modernrelay/notebook-tui` `main`), `validate`/`render`/`catalog`/`schema` (agent-DX, JSON out; schema via Zod 4 `z.toJSONSchema`). The workspace root is the private `notebook-workspace`; `@modernrelay/notebook` is the CLI, not the root. |

### Data flow per render

```
 YAML ─parseNotebook→ Notebook ─createNotebookRuntime→ RuntimeSnapshot ─Renderer→ UI
                         │                            │
                         ▼                            ▼
                 Source.capabilities/read/mutate   assembleLensSpec()
                 (ServerSource)                    → json-render Spec
```

1. `@modernrelay/notebook-core`'s `spec` module parses+validates YAML against frozen v1 Zod schemas. Defines the cell query model (`query.ref` → a server-owned catalog query, or `query.rawGq` raw `.gq` escape hatch) and the `MutationSpec` discriminated union (currently only `set_field`). The v1 schema is strict.
2. `@modernrelay/notebook-core`'s `createNotebookRuntime` validates notebook compatibility against `Source.capabilities()`, resolves `{ $state: "/ptr" }` expressions for data reads, invalidates only cells whose query dependencies changed, calls `Source.read()`, and hands results to `assembleLensSpec` (core's `catalog` module). Control cells skip reads and pass props through to `assembleControlSpec`. Per-cell errors are captured on `CellExecution.error`; runtime-level compatibility failures surface on `RuntimeSnapshot.error`.
3. core's `catalog` module exports `lensComponents` (Zod prop schemas + descriptions) and `lensActions` (`setState`, `mutate`). Author-time props are validated here; the renderer's `defineCatalog` consumes the same schemas.
4. The renderer (`packages/tui` or `packages/web`) calls `defineRegistry` against its UI library, supplying concrete Ink or React+Tailwind component implementations under the same component IDs (`Table`, `Path`, ...). The App subscribes to the runtime snapshot and passes each cell's `LensSpec` to `<Renderer />`.

### The `Source` interface and its implementation

Defined in `@modernrelay/notebook-core` (its `runtime` module) as a capability-aware contract: `capabilities()`, `read(request, context)`, and `mutate(command, context)`. There is one implementation; unsupported features fail during runtime compatibility validation or with explicit source errors:

- **`ServerSource`** (`@modernrelay/notebook-client`): the only source. Invokes server-owned catalog queries by name via the SDK's `og.queries.invoke` (`query.ref`, the default path), or sends raw `.gq` ad-hoc via `og.query` (`query.rawGq` escape hatch). `mutate` compiles the interim `set_field` to `.gq`. omnigraph-server 0.7.0+ serves these under `/graphs/{graph}/…`.

Connection: `cli/src/source.ts` and `tui/src/index.tsx` resolve via the shared Node-only `@modernrelay/notebook-client/node` operator-config resolver (`~/.omnigraph/config.yaml` + `credentials`: named servers, profiles, keyed-token chain). Flags (`--server NAME|URL`/`--graph`/`--token`/`--branch`/`--profile`) and the notebook's `server`/`graph` layer in. `web/src/config.ts` stays on URL params + the `view` proxy — the browser can't read operator files.

### State + mutations

Both Apps instantiate a `NotebookRuntime` and subscribe to `RuntimeSnapshot`. `JSONUIProvider.onStateChange` forwards JSON-pointer patches to `runtime.applyStateChanges()`. The runtime mirrors state, extracts `$state` query dependencies, and re-runs only affected data cells.

Mutations are runtime-owned. Renderer handlers call `runtime.dispatch("mutate", { params })`; the runtime builds mutation context with the originating cell, read target, write target, current state, and optimistic patch metadata. Branch reads write back to that branch. Snapshot reads write to the runtime default branch when one is configured, otherwise the source default applies. Renderers never read from a global mutation source.

### Cells, controls, and `cell.controls`

Two kinds of cells:
- **Data cells** (`Table`/`Path`/`Subgraph`/`ActionList`) — require a `query`.
- **Control cells** (`Button`/`Toggle`/`Select`) — must NOT have a `query`; bind to state via `$bindState` or fire actions via `on.press`.

A data cell may additionally declare inline `controls: [...]` — control descriptors that filter or act on that cell's data view. They render above the lens output as separate json-render specs (`CellExecution.controlSpecs`) and use the same registry as the main lens.

### TypeScript config

Strict mode + `noUncheckedIndexedAccess`. All packages extend `tsconfig.base.json` and emit `dist/` with declaration files; consumers import from `@modernrelay/notebook-<pkg>` (resolves to `dist/index.js`).

## Server-mode prerequisites

omnigraph-server 0.7.0+ is **cluster-only** (RFC-011): every read/write is served under `/graphs/{graph_id}/…`, so server-mode notebooks must carry a `graph:` id (overridable via `--graph`/`?graph=` or the operator-config `default_graph`). The SDK pins to a matching server line — `@modernrelay/omnigraph@^0.7.0` talks to a 0.7.x server only.

`scripts/server-demo.sh` needs an omnigraph **v0.7.0+** checkout on disk — the sibling `../omnigraph` by default, or set `OMNIGRAPH_REPO`. It `cargo build`s `omnigraph-cli` + `omnigraph-server` (release), then materializes a **local filesystem-backed cluster** under `.server-demo/cluster` (graph `company`, schema `examples/server/company.pg`, seed `examples/server/company.jsonl`) via `cluster import`/`apply` + `load`, and boots `omnigraph-server --cluster … --unauthenticated` on `:8080` (PID/log under `.server-demo/`, gitignored). No RustFS/S3 required. Re-running reuses the cluster (mutations persist); delete `.server-demo` to reset. The demo runs unauthenticated, so bearer tokens are ignored; the web app reaches it same-origin through the Vite `/og` proxy (the 0.7.0 server sets no CORS headers).
