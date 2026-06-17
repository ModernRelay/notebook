import { catalogCommand } from "./commands/catalog.js";
import { renderCommand } from "./commands/render.js";
import { schemaCommand } from "./commands/schema.js";
import { validateCommand } from "./commands/validate.js";
import { viewCommand } from "./commands/view.js";

const HELP = `@modernrelay/notebook — run an omnigraph notebook anywhere

Usage: mr-notebook <command> [args]

Commands:
  view <nb.yaml>       Open the notebook in your browser (default)
  tui <nb.yaml>        Render the notebook in your terminal
  validate <nb.yaml>   Parse + capability-check (--json for structured output)
  render <nb.yaml>     Headless run → cell results as JSON
  catalog              Dump the lens/control/action schemas as JSON
  schema [--out FILE]  Emit the notebook JSON Schema

Source flags (view/tui/validate/render):
  --server URL  --graph ID  --token TOKEN  --branch NAME
  (graph id: --graph > $OMNIGRAPH_GRAPH_ID > notebook \`graph:\`)
`;

/** Lazy: only pulls in Ink/React (and its import-time stdin shim) for the TUI. */
async function tuiCommand(argv: string[]): Promise<number> {
  const { main } = await import("@omnigraph/tui");
  main(argv);
  return 0;
}

function isNotebookPath(arg: string): boolean {
  return !arg.startsWith("-") && (arg.endsWith(".yaml") || arg.endsWith(".yml"));
}

async function dispatch(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
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
    case undefined:
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      return 0;
    default:
      // Bare `mr-notebook some.notebook.yaml` → view it.
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
