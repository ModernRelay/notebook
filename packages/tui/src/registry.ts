import { defineCatalog } from "@json-render/core";
import { schema, defineRegistry } from "@json-render/ink";
import { lensActions, lensComponents } from "@modernrelay/notebook-core";
import { Table } from "./components/Table.js";
import { Path } from "./components/Path.js";
import { Subgraph } from "./components/Subgraph.js";
import { ActionList } from "./components/ActionList.js";
import { Timeline } from "./components/Timeline.js";
import { Card } from "./components/Card.js";
import { Quote } from "./components/Quote.js";
import { Text } from "./components/Text.js";
import { Button } from "./components/Button.js";
import { Toggle } from "./components/Toggle.js";
import { Select } from "./components/Select.js";
import { TextInput } from "./components/TextInput.js";
import { NumberInput } from "./components/NumberInput.js";
import { Form } from "./components/Form.js";

const catalog = defineCatalog(schema, {
  components: lensComponents,
  actions: lensActions,
});

const { registry: inkRegistry } = defineRegistry(catalog, {
  components: { Table, Path, Subgraph, ActionList, Form, Timeline, Card, Quote, Text, Button, Toggle, Select, TextInput, NumberInput },
  actions: {
    setState: async (params, setState) => {
      const { statePath, value } = params as { statePath: string; value: unknown };
      setState(statePath, value);
    },
    mutate: async () => {
      throw new Error("mutate action must be handled by NotebookRuntime");
    },
  },
});

export { catalog as inkCatalog, inkRegistry };
