import { readFileSync } from "node:fs";
import { catalogCommand } from "./commands/catalog.js";
import { renderCommand } from "./commands/render.js";
import { schemaCommand } from "./commands/schema.js";
import { validateCommand } from "./commands/validate.js";
import { viewCommand } from "./commands/view.js";

const VERSION = ((): string => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const SOURCE_FLAGS = `Source flags (view/tui/validate/render):
  --server NAME|URL   operator-config server name or a literal URL
  --graph ID          cluster graph id (omnigraph-server 0.7.0+ is cluster-only)
  --token TOKEN       bearer token (else ~/.omnigraph/credentials or env)
  --branch NAME       read/write branch
  --profile NAME      operator-config profile (else $OMNIGRAPH_PROFILE)
  --allow-raw-gq      enable the raw .gq escape hatch (off by default)
With ~/.omnigraph operator config set up (\`omnigraph login\`), no flags needed.`;

const HELP = `@modernrelay/notebook v${VERSION} — run an omnigraph notebook anywhere

Usage: notebook <command> [args]      (npx @modernrelay/notebook <command> …)

Commands:
  view <nb.yaml>       Open the notebook in your browser (default)
  tui <nb.yaml>        Render the notebook in your terminal
  validate <nb.yaml>   Parse + capability-check (--json for structured output)
  render <nb.yaml>     Headless run → cell results as JSON
  catalog              Dump the lens/control/action schemas as JSON
  schema [--out FILE]  Emit the notebook JSON Schema

  --version, -v        Print the version
  --help, -h           Print this help (or \`<command> --help\`)

${SOURCE_FLAGS}
`;

const COMMAND_HELP: Record<string, string> = {
  view: `notebook view <nb.yaml> [--port N] [--no-open] [source flags]
  Serve the prebuilt web SPA and open the notebook in a browser. In server
  mode, /og reverse-proxies omnigraph-server with the token injected
  server-side (the browser stays same-origin).

${SOURCE_FLAGS}`,
  tui: `notebook tui <nb.yaml> [source flags]
  Render the notebook in the terminal (Ink).

${SOURCE_FLAGS}`,
  validate: `notebook validate <nb.yaml> [--json] [source flags]
  Parse the notebook and capability-check it against the source. Exit 0 = valid,
  1 = invalid, 2 = usage. --json emits { ok, errors[], warnings? }.`,
  render: `notebook render <nb.yaml> [--watch] [--timeout MS] [--compact] [source flags]
  Headless run → each cell's resolved result as JSON. --watch re-runs on
  notebook-file change (Ctrl-C to stop).

${SOURCE_FLAGS}`,
  catalog: `notebook catalog
  Dump the lens/control/action prop schemas (author-facing) as JSON.`,
  schema: `notebook schema [--out FILE]
  Emit the notebook JSON Schema to stdout (or FILE).`,
};

function hasHelpFlag(rest: readonly string[]): boolean {
  return rest.includes("--help") || rest.includes("-h");
}

/** Lazy: only pulls in Ink/React (and its import-time stdin shim) for the TUI. */
async function tuiCommand(argv: string[]): Promise<number> {
  const { main } = await import("@modernrelay/notebook-tui");
  // main is synchronous (returns void) today; await-wrapping means an async
  // variant would still surface startup errors through the dispatcher's .catch.
  await Promise.resolve(main(argv));
  return 0;
}

function isNotebookPath(arg: string): boolean {
  return !arg.startsWith("-") && (arg.endsWith(".yaml") || arg.endsWith(".yml"));
}

async function dispatch(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  // `<command> --help` → that command's usage.
  const cmdHelp = command !== undefined ? COMMAND_HELP[command] : undefined;
  if (cmdHelp && hasHelpFlag(rest)) {
    process.stdout.write(`${cmdHelp}\n`);
    return 0;
  }

  switch (command) {
    case "view":
      return viewCommand(rest);
    case "tui":
      return tuiCommand(rest);
    case "validate":
      return validateCommand(rest);
    case "render":
      return renderCommand(rest);
    case "catalog":
      return catalogCommand(rest);
    case "schema":
      return schemaCommand(rest);
    case "-v":
    case "--version":
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case undefined:
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return 0;
    default:
      // Bare `notebook some.notebook.yaml` → view it.
      if (isNotebookPath(command)) return viewCommand([command, ...rest]);
      process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

dispatch(process.argv.slice(2))
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
