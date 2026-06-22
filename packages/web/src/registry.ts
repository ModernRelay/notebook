import { defineCatalog } from "@json-render/core";
import { schema, defineRegistry } from "@json-render/react";
import { lensActions, lensComponents } from "@modernrelay/notebook-core";
import { setAtPointer } from "@modernrelay/notebook-core";
import { Table } from "./components/Table.js";
import { Path } from "./components/Path.js";
import { Subgraph } from "./components/Subgraph.js";
import { ActionList } from "./components/ActionList.js";
import { Timeline } from "./components/Timeline.js";
import { Card } from "./components/Card.js";
import { Button } from "./components/Button.js";
import { Toggle } from "./components/Toggle.js";
import { Select } from "./components/Select.js";

const catalog = defineCatalog(schema, {
  components: lensComponents,
  actions: lensActions,
});

// React's SetState is `(updater: (prev) => next) => void`. We use the
// executor's setAtPointer helper to write at JSON-pointer paths immutably.
const { registry: webRegistry } = defineRegistry(catalog, {
  components: { Table, Path, Subgraph, ActionList, Timeline, Card, Button, Toggle, Select },
  actions: {
    setState: async (params, setState) => {
      const { statePath, value } = params as {
        statePath: string;
        value: unknown;
      };
      setState((prev) => setAtPointer(prev, statePath, value));
    },
    mutate: async () => {
      throw new Error("mutate action must be handled by NotebookRuntime");
    },
  },
});

export { catalog as webCatalog, webRegistry };
