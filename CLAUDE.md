# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This is a pnpm workspace (pnpm 10.30.3, Node ≥20). All scripts run from the repo root unless noted.

```bash
pnpm install                                     # install workspace deps
pnpm -r build                                    # tsc-build every package — REQUIRED before tui/web run
pnpm -r typecheck                                # tsc --noEmit across all packages
pnpm -r test                                     # vitest run across all packages

pnpm --filter @omnigraph/<pkg> build             # rebuild one package
pnpm --filter @omnigraph/<pkg> test              # vitest run for one package
pnpm --filter @omnigraph/<pkg> test -- <pattern> # single test file/name

pnpm tui examples/company.notebook.yaml          # Ink TUI, fixture mode
pnpm tui examples/company-server.notebook.yaml --server http://127.0.0.1:8080 \
  --token devtoken                               # TUI, server mode
pnpm --filter @omnigraph/web dev                 # Vite dev server at 127.0.0.1:5173
                                                 #   add ?mode=server to switch backends
pnpm --filter @omnigraph/web build               # tsc + vite production build

scripts/server-demo.sh                           # build omnigraph CLI/server, init repo on RustFS,
                                                 #   start omnigraph-server on :8080 (PID under .server-demo/)
```

The TUI consumes built `dist/` from sibling workspace packages — **always run `pnpm -r build` after editing a non-TUI/non-web package** before running `pnpm tui`. Web's Vite bundles via TS sources directly, but `tsc --noEmit` (`pnpm -r typecheck`) is what enforces cross-package types.

## Architecture

**One catalog, two renderers, one fixture-driven dev loop.** A notebook is YAML; each cell renders as a typed lens (`Table`/`Path`/`Subgraph`/`ActionList`) or a control (`Button`/`Toggle`/`Select`). Both the Ink TUI and the React Web app share the same catalog of component definitions and the same executor; only the leaf component implementations and the host shell differ.

### Package map

| Package | Role |
|---|---|
| `@omnigraph/notebook-spec` | Zod schemas + YAML parser for notebooks, fixture-query DSL, mutation specs. |
| `@omnigraph/catalog` | Component+action definitions (Zod prop schemas) shared by both renderers; `assembleLensSpec` / `assembleControlSpec` produce json-render specs. |
| `@omnigraph/runtime` | Capability-aware notebook runtime: execution, state mirror, dependency invalidation, action dispatch, mutation lifecycle, optimistic reconciliation. |
| `@omnigraph/fixture` | In-memory `FixtureSource` over JSON graphs; `/node` subpath holds the Node-only fs loader so it stays out of the browser bundle. |
| `@omnigraph/client` | `ServerSource` + `translateFixtureQuery` / `translateMutation` (fixture DSL → `.gq`) + HTTP client for `/read` and `/change`. |
| `@omnigraph/tui` | Ink renderer + CLI entry (`bin/omnigraph-tui.js`); host shell for terminal. |
| `@omnigraph/web` | Vite + React + Tailwind renderer; host shell for browser. |

### Data flow per render

```
 YAML ─parseNotebook→ Notebook ─createNotebookRuntime→ RuntimeSnapshot ─Renderer→ UI
                         │                            │
                         ▼                            ▼
                 Source.capabilities/read/mutate   assembleLensSpec()
                 (Fixture | Server)                → json-render Spec
```

1. `@omnigraph/notebook-spec` parses+validates YAML against frozen v1 Zod schemas. Defines the `FixtureQuery` DSL (`nodes` / `path` / `ego`) and the `MutationSpec` discriminated union (currently only `set_field`).
2. `@omnigraph/runtime::createNotebookRuntime` validates notebook compatibility against `Source.capabilities()`, resolves `{ $state: "/ptr" }` expressions for data reads, invalidates only cells whose query dependencies changed, calls `Source.read()`, and hands results to `assembleLensSpec` from `@omnigraph/catalog`. Control cells skip reads and pass props through to `assembleControlSpec`. Per-cell errors are captured on `CellExecution.error`; runtime-level compatibility failures surface on `RuntimeSnapshot.error`.
3. `@omnigraph/catalog` exports `lensComponents` (Zod prop schemas + descriptions) and `lensActions` (`setState`, `mutate`). Author-time props are validated here; the renderer's `defineCatalog` consumes the same schemas.
4. The renderer (`packages/tui` or `packages/web`) calls `defineRegistry` against its UI library, supplying concrete Ink or React+Tailwind component implementations under the same component IDs (`Table`, `Path`, ...). The App subscribes to the runtime snapshot and passes each cell's `LensSpec` to `<Renderer />`.

### The `Source` interface and its two implementations

Defined in `@omnigraph/runtime` as a capability-aware contract: `capabilities()`, `read(request, context)`, and `mutate(command, context)`. The notebook YAML is identical between modes where source capabilities overlap; unsupported features fail during runtime compatibility validation or with explicit source errors:

- **`FixtureSource`** (`@omnigraph/fixture`): runs the fixture-DSL query against an in-memory JSON graph; mutations update nodes in place per-process (no disk writeback).
- **`ServerSource`** (`@omnigraph/client`): translates fixture-DSL queries to `.gq` source via `translateFixtureQuery`/`translateMutation` and POSTs to omnigraph-server's `/read` and `/change`. `ego` queries are decomposed into center/incident reads and merged client-side. Cells may still bypass translation by setting deprecated `query.source` raw `.gq`.

Mode selection: `tui/src/index.tsx` and `web/src/App.tsx` pick a source from `notebook.fixture` (relative JSON path) vs `notebook.server` (URL), with CLI flags or URL flags (`?mode=server|fixture`, `?server=...`, `?notebook=...`) as overrides.

### State + mutations

Both Apps instantiate a `NotebookRuntime` and subscribe to `RuntimeSnapshot`. `JSONUIProvider.onStateChange` forwards JSON-pointer patches to `runtime.applyStateChanges()`. The runtime mirrors state, extracts `$state` query dependencies, and re-runs only affected data cells.

Mutations are runtime-owned. Renderer handlers call `runtime.dispatch("mutate", { params })`; the runtime builds mutation context with the originating cell, read target, write target, current state, and optimistic patch metadata. Branch reads write back to that branch. Snapshot reads write to the runtime default branch when one is configured, otherwise the source default applies. Renderers never read from a global mutation source.

### Cells, controls, and `cell.controls`

Two kinds of cells:
- **Data cells** (`Table`/`Path`/`Subgraph`/`ActionList`) — require a `query`.
- **Control cells** (`Button`/`Toggle`/`Select`) — must NOT have a `query`; bind to state via `$bindState` or fire actions via `on.press`.

A data cell may additionally declare inline `controls: [...]` — control descriptors that filter or act on that cell's data view. They render above the lens output as separate json-render specs (`CellExecution.controlSpecs`) and use the same registry as the main lens.

### TypeScript config

Strict mode + `noUncheckedIndexedAccess`. All packages extend `tsconfig.base.json` and emit `dist/` with declaration files; consumers import from `@omnigraph/<pkg>` (resolves to `dist/index.js`). The `@omnigraph/fixture/node` subpath splits Node-only fs loaders out of the browser bundle.

## Server-mode prerequisites

`scripts/server-demo.sh` expects RustFS already running at `127.0.0.1:9000` and the sibling `../omnigraph` checkout on disk (it `cargo build`s `omnigraph-cli` and `omnigraph-server` in release). It writes its server PID + log to `.server-demo/` (gitignored). The bearer token defaults to `devtoken`; set `OMNIGRAPH_TOKEN` to override.
