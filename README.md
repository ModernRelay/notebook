# @modernrelay/notebook

[![npm](https://img.shields.io/npm/v/@modernrelay/notebook.svg)](https://www.npmjs.com/package/@modernrelay/notebook)

```bash
npm i -g @modernrelay/notebook   # or: npx @modernrelay/notebook view my.notebook.yaml
```

Notebook UI for [OmniGraph](https://github.com/ModernRelay/omnigraph). Each notebook cell is a typed *lens primitive* (Table, Path, Subgraph) rendered from a server-owned catalog query — not a generic graph viewer.

One catalog of components, two renderers (terminal and web), one server-backed runtime.

## What it's for

Turn an OmniGraph graph database into a **read-and-act dashboard you describe in one YAML file** — rendered identically in a terminal and a browser.

Normally you inspect a graph by writing queries and reading JSON, or by building a bespoke UI. A notebook is the layer between: a YAML file that *declares what slices of the graph to show and what actions to allow*, not code. Each data cell is a typed lens (`Table`/`Path`/`Subgraph`/`ActionList`/`Timeline`/`Card`/`Quote`/`Text`) fed by `query.ref` to a server-owned `.gq` catalog query, or a control (`Select`/`Toggle`/`Button`) that filters state or dispatches actions. See `examples/company-server.notebook.yaml`: a clause review list with inline Approve/Reject buttons, a decisions table, and a `Signal → Decision` path — no UI code anywhere.

Two bets make it work:

- **Typed lenses, not a generic graph viewer** — you name the view you want; the system renders it.
- **Write once, render anywhere** — the same YAML drives the Ink terminal UI and the React web UI, against a live omnigraph-server (a local cluster in dev, a remote server in prod). It's bidirectional: lenses read the graph, controls and actions write back to it.

## Layout & interaction

Cells render on a **canvas**, not a fixed stack. Each cell declares a `width`
(`full`/`half`/`third`/`two-thirds`) and flows into a responsive grid; in the
browser an **Edit layout** toggle lets you drag-reorder and drag-resize tiles,
persisted per-notebook in `localStorage` (the YAML stays the source of truth, and
Reset clears it). Cells are **dependent**: a Table writes a selection to `$state`
and any cell whose query reads it re-resolves *in place* — master-detail with no
modal. Long cells scroll internally and the header is sticky. Web-first; the
terminal is layout-flat (one cell per tab, `width` ignored).

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
reaches the page). Source flags (`--server NAME|URL` / `--graph` / `--token` /
`--branch` / `--profile`) apply to `view`/`tui`/`validate`/`render`; connection
resolves flags → omnigraph operator config (`~/.omnigraph/config.yaml` +
`credentials`) → the notebook's `server`/`graph`, so once you've `omnigraph
login`'d no flags are needed.

### Agent / scripting surface

Use the same zero-install `npx` form (or the short `notebook` command after a
global install):

```bash
npx @modernrelay/notebook schema                   # JSON Schema for the notebook YAML
npx @modernrelay/notebook catalog                  # lens/control/action prop schemas as JSON
npx @modernrelay/notebook validate nb.yaml --json  # parse + refs/params vs live catalog → { ok, errors[], warnings? }
npx @modernrelay/notebook render   nb.yaml         # headless run → cell results as JSON
```

## Develop (monorepo)

```bash
pnpm install
pnpm -r build
scripts/server-demo.sh                           # boot a local omnigraph cluster (graph `company`)
pnpm tui examples/company-server.notebook.yaml   # terminal (needs the cluster above)
pnpm --filter @modernrelay/notebook-web dev                 # browser at 127.0.0.1:5173
pnpm --filter @modernrelay/notebook build        # bundle the CLI (tsup) + web-dist
```

`scripts/server-demo.sh` stands up a local filesystem-backed omnigraph cluster; the TUI and web app render the demo cells against it (the web app talks to it same-origin via the Vite `/og` proxy).

## Packages

| Package | Purpose |
|---|---|
| `@modernrelay/notebook-core` | The engine — start here. Three modules behind one entry: `spec` (Zod YAML schemas + `ref`/`rawGq` query model — raw `.gq` is a capability-gated escape hatch, off by default), `catalog` (`lensComponents`/`lensActions` + `assembleLensSpec`), `runtime` (capability-aware execution, state, mutations). The `@json-render/core` analog. |
| `@modernrelay/notebook-client` | The only data source — `ServerSource` + a `Client` facade over the `@modernrelay/omnigraph` SDK. |
| `@modernrelay/notebook-tui` | Ink renderer + the `omnigraph-tui` binary. |
| `@modernrelay/notebook-web` | Vite + React + Tailwind v4 SPA. |
| `@modernrelay/notebook` (`packages/cli`) | The published CLI — bundles the libs + ships the web SPA; `view`/`tui`/`validate`/`render`/`catalog`/`schema`. |

## Status

Pre-release. The notebook YAML shape (`version: 1`) is the only artifact intended to be stable.
