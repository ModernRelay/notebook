import { z } from "zod";
import type { Spec, UIElement, VisibilityCondition } from "@json-render/core";
import type { ComponentKind, LensKind, ActionBinding } from "../spec/index.js";
import {
  TableAuthorPropsSchema,
  TableRuntimePropsSchema,
  TableDescription,
  applyTableDerivations,
  type TableAuthorProps,
  type TableRuntimeProps,
} from "./lenses/table.js";
import {
  TreeAuthorPropsSchema,
  TreeRuntimePropsSchema,
  TreeDescription,
  type TreeAuthorProps,
  type TreeRuntimeProps,
} from "./lenses/tree.js";
import {
  PathAuthorPropsSchema,
  PathRuntimePropsSchema,
  PathDescription,
  type PathAuthorProps,
  type PathRuntimeProps,
} from "./lenses/path.js";
import {
  SubgraphAuthorPropsSchema,
  SubgraphRuntimePropsSchema,
  SubgraphDescription,
  type SubgraphAuthorProps,
  type SubgraphRuntimeProps,
} from "./lenses/subgraph.js";
import {
  ActionListAuthorPropsSchema,
  ActionListRuntimePropsSchema,
  ActionListDescription,
  type ActionListAuthorProps,
  type ActionListRuntimeProps,
} from "./lenses/action_list.js";
import {
  FormAuthorPropsSchema,
  FormRuntimePropsSchema,
  FormDescription,
  type FormAuthorProps,
  type FormRuntimeProps,
} from "./lenses/form.js";
import {
  TimelineAuthorPropsSchema,
  TimelineRuntimePropsSchema,
  TimelineDescription,
  type TimelineAuthorProps,
  type TimelineRuntimeProps,
} from "./lenses/timeline.js";
import {
  CardAuthorPropsSchema,
  CardRuntimePropsSchema,
  CardDescription,
  type CardAuthorProps,
  type CardRuntimeProps,
} from "./lenses/card.js";
import {
  QuoteAuthorPropsSchema,
  QuoteRuntimePropsSchema,
  QuoteDescription,
  type QuoteAuthorProps,
  type QuoteRuntimeProps,
} from "./lenses/quote.js";
import {
  TextAuthorPropsSchema,
  TextRuntimePropsSchema,
  TextDescription,
  type TextAuthorProps,
  type TextRuntimeProps,
} from "./lenses/text.js";
import {
  ButtonRuntimePropsSchema,
  ButtonDescription,
} from "./lenses/button.js";
import {
  ToggleRuntimePropsSchema,
  ToggleDescription,
} from "./lenses/toggle.js";
import {
  SelectAuthorPropsSchema,
  SelectRuntimePropsSchema,
  type SelectAuthorProps,
  SelectDescription,
} from "./lenses/select.js";
import {
  TextInputRuntimePropsSchema,
  TextInputDescription,
} from "./lenses/text_input.js";
import {
  NumberInputRuntimePropsSchema,
  NumberInputDescription,
} from "./lenses/number_input.js";

export * from "./lenses/table.js";
export * from "./lenses/tree.js";
export * from "./lenses/path.js";
export * from "./lenses/subgraph.js";
export * from "./lenses/action_list.js";
export * from "./lenses/form.js";
export * from "./lenses/timeline.js";
export * from "./lenses/card.js";
export * from "./lenses/quote.js";
export * from "./lenses/text.js";
export * from "./lenses/button.js";
export * from "./lenses/toggle.js";
export * from "./lenses/select.js";
export * from "./lenses/text_input.js";
export * from "./lenses/number_input.js";

/** A typed row returned by a Source.read(). */
export type ResultRow = Record<string, unknown>;

/** Shape the executor passes to `assembleLensSpec`. */
export interface QueryResult {
  query_name: string;
  target: string;
  row_count: number;
  columns: string[];
  rows: ResultRow[];
}

/**
 * Renderer-agnostic component definitions for json-render's `defineCatalog`.
 *
 * The Zod schemas here are the **runtime** prop shapes:
 *   - For data lenses (Table/Path/Subgraph), this includes `rows`, injected
 *     by the executor via `assembleLensSpec`.
 *   - For controls (Button/Toggle/Select), this is the author-declared shape;
 *     state-bound fields (e.g. Toggle.value via $bindState) are resolved by
 *     the framework before reaching the component.
 *
 * Author-time validation of data-lens YAML props uses the author-only
 * schemas (without `rows`) inside `assembleLensSpec` below.
 */
export const lensComponents = {
  Table:      { props: TableRuntimePropsSchema,      description: TableDescription },
  Tree:       { props: TreeRuntimePropsSchema,       description: TreeDescription },
  Path:       { props: PathRuntimePropsSchema,       description: PathDescription },
  Subgraph:   { props: SubgraphRuntimePropsSchema,   description: SubgraphDescription },
  ActionList: { props: ActionListRuntimePropsSchema, description: ActionListDescription },
  Form:       { props: FormRuntimePropsSchema,       description: FormDescription },
  Timeline:   { props: TimelineRuntimePropsSchema,   description: TimelineDescription },
  Card:       { props: CardRuntimePropsSchema,       description: CardDescription },
  Quote:      { props: QuoteRuntimePropsSchema,      description: QuoteDescription },
  Text:       { props: TextRuntimePropsSchema,       description: TextDescription },
  Button:     { props: ButtonRuntimePropsSchema,     description: ButtonDescription },
  Toggle:     { props: ToggleRuntimePropsSchema,     description: ToggleDescription },
  Select:     { props: SelectRuntimePropsSchema,     description: SelectDescription },
  TextInput:  { props: TextInputRuntimePropsSchema,  description: TextInputDescription },
  NumberInput:{ props: NumberInputRuntimePropsSchema,description: NumberInputDescription },
} as const;

/**
 * Action surface for the catalog. `setState` is built-in semantics in
 * @json-render/core; declaring it here lets us reference it from notebook
 * YAML (via `cell.on.press = { action: 'setState', ... }`) regardless of
 * renderer.
 *
 * `approve` / `reject` are demo handler-bound actions. The host renderer
 * (App.tsx) provides their implementations via JSONUIProvider.handlers.
 */
import { MutationDispatchSchema } from "../spec/index.js";

export const lensActions = {
  setState: {
    params: z.object({ statePath: z.string(), value: z.unknown() }),
    description: "Write a value to the state model at the given JSON pointer.",
  },
  /**
   * Mutation against omnigraph-server (via the @modernrelay/omnigraph SDK).
   * Two accepted shapes: a single mutation `{ spec, row?, rowKey? }` (each
   * invocation one commit — an ActionList row button supplies the clicked
   * `row`/`rowKey`, a mutation Button just `spec`), or a Form's dirty batch
   * `{ mutations: [{spec}], input }` — sequential independent commits with
   * one saving flag and one final re-read. The runtime resolves
   * `$row`/`$state`/`$input` params and any optimistic overlay.
   */
  mutate: {
    params: MutationDispatchSchema,
    description:
      "Run mutation(s) against the source. Single: { spec, row?, rowKey? }. Form batch: { mutations: [{spec}], input } — dirty fields only, resolved via $input.",
  },
} as const;

/** Element shape for json-render's `<Renderer />`. */
export type LensElement = UIElement<ComponentKind, Record<string, unknown>>;

/** json-render-shaped flat spec produced for each notebook cell. */
export type LensSpec = Spec;

/**
 * Build a spec for a data cell — validates author props for the lens and
 * merges `result.rows` in.
 */
export function assembleLensSpec(
  cellId: string,
  lens: LensKind | "Select",
  authorProps: unknown,
  result: QueryResult,
  extra?: {
    on?: Record<string, ActionBinding>;
    visible?: VisibilityCondition;
    runtimeProps?: Record<string, unknown>;
  },
): LensSpec {
  const baseProps = buildRuntimeProps(lens, authorProps, result);
  const runtimeProps =
    extra?.runtimeProps !== undefined
      ? { ...baseProps, ...extra.runtimeProps }
      : baseProps;
  return {
    root: cellId,
    elements: { [cellId]: buildElement(lens, runtimeProps, extra) },
  };
}

/**
 * Build a spec for a control cell — passes raw props through (json-render
 * resolves `$state` / `$bindState` / `$cond` expressions at render time).
 * No author-prop validation here; the catalog's runtime Zod schema
 * validates the resolved shape inside json-render's renderer.
 */
export function assembleControlSpec(
  cellId: string,
  kind: ComponentKind,
  props: Record<string, unknown>,
  extra?: {
    on?: Record<string, ActionBinding>;
    visible?: VisibilityCondition;
    /** Runtime-injected props (e.g. a mutation Button's `runtime` block). */
    runtimeProps?: Record<string, unknown>;
  },
): LensSpec {
  const merged =
    extra?.runtimeProps !== undefined
      ? { ...props, ...extra.runtimeProps }
      : props;
  return {
    root: cellId,
    elements: { [cellId]: buildElement(kind, merged, extra) },
  };
}

function buildElement(
  type: ComponentKind,
  props: Record<string, unknown>,
  extra?: {
    on?: Record<string, ActionBinding>;
    visible?: VisibilityCondition;
    runtimeProps?: Record<string, unknown>;
  },
): LensElement {
  const el: LensElement = { type, props };
  if (extra?.on !== undefined && Object.keys(extra.on).length > 0) {
    el.on = extra.on;
  }
  if (extra?.visible !== undefined) el.visible = extra.visible;
  return el;
}

function buildRuntimeProps(
  lens: LensKind | "Select",
  authorProps: unknown,
  result: QueryResult,
): Record<string, unknown> {
  switch (lens) {
    case "Table": {
      const author: TableAuthorProps = TableAuthorPropsSchema.parse(authorProps);
      // Derived (expr) columns and author sort are materialized here, per
      // query refresh, so every renderer (web, TUI) shows identical values.
      const runtime: TableRuntimeProps = {
        ...author,
        rows: applyTableDerivations(author, result.rows, Date.now()),
      };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Tree": {
      const author: TreeAuthorProps = TreeAuthorPropsSchema.parse(authorProps);
      const runtime: TreeRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Path": {
      const author: PathAuthorProps = PathAuthorPropsSchema.parse(authorProps);
      const runtime: PathRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Subgraph": {
      const author: SubgraphAuthorProps =
        SubgraphAuthorPropsSchema.parse(authorProps);
      const runtime: SubgraphRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "ActionList": {
      const author: ActionListAuthorProps =
        ActionListAuthorPropsSchema.parse(authorProps);
      const runtime: ActionListRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Form": {
      const author: FormAuthorProps = FormAuthorPropsSchema.parse(authorProps);
      const runtime: FormRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Select": {
      // Query-backed entity picker — the only path that routes Select here
      // (a query-less Select stays on the control path).
      const author: SelectAuthorProps =
        SelectAuthorPropsSchema.parse(authorProps);
      const runtime = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Timeline": {
      const author: TimelineAuthorProps =
        TimelineAuthorPropsSchema.parse(authorProps);
      const runtime: TimelineRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Card": {
      const author: CardAuthorProps = CardAuthorPropsSchema.parse(authorProps);
      const runtime: CardRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Quote": {
      const author: QuoteAuthorProps = QuoteAuthorPropsSchema.parse(authorProps);
      const runtime: QuoteRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
    case "Text": {
      const author: TextAuthorProps = TextAuthorPropsSchema.parse(authorProps);
      const runtime: TextRuntimeProps = { ...author, rows: result.rows };
      return runtime as unknown as Record<string, unknown>;
    }
  }
}
