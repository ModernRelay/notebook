import { defineCatalog } from "@json-render/core";
import { schema, defineRegistry } from "@json-render/ink";
import { lensActions, lensComponents } from "@omnigraph/catalog";
import { getMutationSource } from "@omnigraph/executor";
import type { MutationParams } from "@omnigraph/notebook-spec";
import { Table } from "./components/Table.js";
import { Path } from "./components/Path.js";
import { Subgraph } from "./components/Subgraph.js";
import { ActionList } from "./components/ActionList.js";
import { Button } from "./components/Button.js";
import { Toggle } from "./components/Toggle.js";
import { Select } from "./components/Select.js";

const catalog = defineCatalog(schema, {
  components: lensComponents,
  actions: lensActions,
});

const { registry: inkRegistry } = defineRegistry(catalog, {
  components: { Table, Path, Subgraph, ActionList, Button, Toggle, Select },
  actions: {
    setState: async (params, setState) => {
      const { statePath, value } = params as { statePath: string; value: unknown };
      setState(statePath, value);
    },
    mutate: async (params, setState) => {
      const debug = !!process.env.OMNIGRAPH_TUI_DEBUG;
      if (debug) process.stderr.write(`[debug] mutate handler entered: ${JSON.stringify(params)}\n`);
      try {
        await getMutationSource().mutate!(params as MutationParams);
        if (debug) process.stderr.write(`[debug] mutate handler succeeded\n`);
      } catch (err) {
        process.stderr.write(`[error] mutate handler threw: ${(err as Error).message}\n`);
        throw err;
      }
      // Bump an epoch to force the App's re-execution loop to pick up
      // the new state. The App's onStateChange handler observes this and
      // triggers `runNotebook` again.
      setState("/__mutation_epoch__", Date.now());
    },
  },
});

export { catalog as inkCatalog, inkRegistry };
