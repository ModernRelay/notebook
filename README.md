# @modernrelay/notebook

Notebook UI for [OmniGraph](https://github.com/ModernRelay/omnigraph). Each notebook cell is a typed *lens primitive* (Table, Path, Subgraph) rendered from a structured query — not a generic graph viewer.

One catalog of components, two renderers (terminal and web), one fixture-driven dev loop.

## Install & run (CLI)

The published front door is **`@modernrelay/notebook`** — point it at any notebook YAML:

```bash
npx @modernrelay/notebook view  my.notebook.yaml                      # browser
npx @modernrelay/notebook tui   my.notebook.yaml                      # terminal
npx @modernrelay/notebook view  my.notebook.yaml \
  --server https://graph.example.com --graph my-graph --token $TOK    # live cluster
```

`view` serves the prebuilt SPA locally and, in server mode, reverse-proxies the
omnigraph-server with the bearer token injected server-side (the browser stays
same-origin — omnigraph-server 0.7.0 sets no CORS headers, and the token never
reaches the page). Source flags (`--server/--graph/--token/--branch`) apply to
`view`/`tui`/`validate`/`render`; graph-id precedence is `--graph` →
`$OMNIGRAPH_GRAPH_ID` → notebook `graph:`.

### Agent / scripting surface

```bash
mr-notebook schema                 # JSON Schema for the notebook YAML
mr-notebook catalog                # lens/control/action prop schemas as JSON
mr-notebook validate nb.yaml --json    # { ok, errors[], warnings? }, exit 0/1
mr-notebook render   nb.yaml           # headless run → cell results as JSON
```

## Develop (monorepo)

```bash
pnpm install
pnpm -r build
pnpm tui examples/company.notebook.yaml          # terminal
pnpm --filter @omnigraph/web dev                 # browser at 127.0.0.1:5173
pnpm --filter @modernrelay/notebook build        # bundle the CLI (tsup) + web-dist
```

The fixture demos render the same cells against the in-memory `examples/fixtures/company-context.json`.

## Packages

| Package | Purpose |
|---|---|
| `@omnigraph/notebook-spec` | Zod schemas for the notebook YAML + structured query DSL. |
| `@omnigraph/fixture` | In-memory loader + nodes/path/ego query runner. |
| `@omnigraph/catalog` | Shared `lensComponents` map + `assembleLensSpec` helper. |
| `@omnigraph/runtime` | Notebook runtime for source capabilities, execution, state, actions, and mutations. |
| `@omnigraph/client` | HTTP client + live `ServerSource` adapter for omnigraph-server. |
| `@omnigraph/tui` | Ink renderer + the `omnigraph-tui` binary. |
| `@omnigraph/web` | Vite + React + Tailwind v4 SPA. |
| `@modernrelay/notebook` (`packages/cli`) | The published CLI — bundles the libs + ships the web SPA; `view`/`tui`/`validate`/`render`/`catalog`/`schema`. |

## Status

Pre-release. The notebook YAML shape (`version: 1`) is the only artifact intended to be stable.
