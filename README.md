# @modernrelay/notebook

Notebook UI for [OmniGraph](https://github.com/ModernRelay/omnigraph). Each notebook cell is a typed *lens primitive* (Table, Path, Subgraph) rendered from a structured query — not a generic graph viewer.

One catalog of components, two renderers (terminal and web), one fixture-driven dev loop.

## Quick start

```bash
pnpm install
pnpm -r build
pnpm tui examples/company.notebook.yaml          # terminal
pnpm --filter @omnigraph/web dev                 # browser at 127.0.0.1:5173
```

Both render the same six cells against the in-memory `examples/fixtures/company-context.json` (50 nodes, 110 edges).

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

## Status

Pre-release. The notebook YAML shape (`version: 1`) is the only artifact intended to be stable.
