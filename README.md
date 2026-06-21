# @modernrelay/notebook

Notebook UI for [OmniGraph](https://github.com/ModernRelay/omnigraph). Each notebook cell is a typed *lens primitive* (Table, Path, Subgraph) rendered from a structured query — not a generic graph viewer.

One catalog of components, two renderers (terminal and web), one fixture-driven dev loop.

## What it's for

Turn an OmniGraph graph database into a **read-and-act dashboard you describe in one YAML file** — rendered identically in a terminal and a browser.

Normally you inspect a graph by writing queries and reading JSON, or by building a bespoke UI. A notebook is the layer between: a YAML file that *declares what slices of the graph to show and what actions to allow*, not code. Each cell is a typed lens (`Table`/`Path`/`Subgraph`/`ActionList`) fed by a structured query, or a control (`Select`/`Toggle`/`Button`) that filters state or mutates the graph. See `examples/company.notebook.yaml`: a status filter, a decisions table, a `Signal → Decision → Actor` path, an ego subgraph, and a clause list with inline Approve/Reject buttons — no UI code anywhere.

Two bets make it work:

- **Typed lenses, not a generic graph viewer** — you name the view you want; the system renders it.
- **Write once, render anywhere** — the same YAML drives the Ink terminal UI and the React web UI, against an in-memory fixture (dev) or a live omnigraph-server (prod). It's bidirectional: lenses read the graph, controls and actions write back to it.

## Install & run (CLI)

The published front door is **`@modernrelay/notebook`** — point it at any notebook YAML:

```bash
npx @modernrelay/notebook view  my.notebook.yaml                      # browser
npx @modernrelay/notebook tui   my.notebook.yaml                      # terminal
npx @modernrelay/notebook view  my.notebook.yaml \
  --server https://graph.example.com --graph my-graph --token $TOK    # live cluster
```

Or install it once and use the short **`notebook`** command (`mr-notebook` is an alias):

```bash
npm i -g @modernrelay/notebook
notebook view my.notebook.yaml
```

`view` serves the prebuilt SPA locally and, in server mode, reverse-proxies the
omnigraph-server with the bearer token injected server-side (the browser stays
same-origin — omnigraph-server 0.7.0 sets no CORS headers, and the token never
reaches the page). Source flags (`--server/--graph/--token/--branch`) apply to
`view`/`tui`/`validate`/`render`; graph-id precedence is `--graph` →
`$OMNIGRAPH_GRAPH_ID` → notebook `graph:`.

### Agent / scripting surface

Use the same zero-install `npx` form (or the short `notebook` command after a
global install):

```bash
npx @modernrelay/notebook schema                   # JSON Schema for the notebook YAML
npx @modernrelay/notebook catalog                  # lens/control/action prop schemas as JSON
npx @modernrelay/notebook validate nb.yaml --json  # { ok, errors[], warnings? }, exit 0/1
npx @modernrelay/notebook render   nb.yaml         # headless run → cell results as JSON
```

## Develop (monorepo)

```bash
pnpm install
pnpm -r build
pnpm tui examples/company.notebook.yaml          # terminal
pnpm --filter @modernrelay/notebook-web dev                 # browser at 127.0.0.1:5173
pnpm --filter @modernrelay/notebook build        # bundle the CLI (tsup) + web-dist
```

The fixture demos render the same cells against the in-memory `examples/fixtures/company-context.json`.

## Packages

| Package | Purpose |
|---|---|
| `@modernrelay/notebook-core` | The engine — start here. Three modules behind one entry: `spec` (Zod YAML schemas + query DSL), `catalog` (`lensComponents`/`lensActions` + `assembleLensSpec`), `runtime` (capability-aware execution, state, mutations). The `@json-render/core` analog. |
| `@modernrelay/notebook-fixture` | In-memory loader + nodes/path/ego query runner. |
| `@modernrelay/notebook-client` | HTTP client + live `ServerSource` adapter for omnigraph-server. |
| `@modernrelay/notebook-tui` | Ink renderer + the `omnigraph-tui` binary. |
| `@modernrelay/notebook-web` | Vite + React + Tailwind v4 SPA. |
| `@modernrelay/notebook` (`packages/cli`) | The published CLI — bundles the libs + ships the web SPA; `view`/`tui`/`validate`/`render`/`catalog`/`schema`. |

## Status

Pre-release. The notebook YAML shape (`version: 1`) is the only artifact intended to be stable.
