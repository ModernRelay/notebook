import { z } from "zod";
import { MutationSpecSchema } from "../../spec/index.js";

/**
 * A picker field's options source: a catalog READ query invoked alongside the
 * cell's main read. Deliberately narrower than a cell query — no rawGq /
 * branch / snapshot in v1.
 */
export const OptionsQuerySchema = z
  .object({
    ref: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type OptionsQuery = z.infer<typeof OptionsQuerySchema>;

/**
 * One typed field in a Form. Each field carries its OWN catalog mutation —
 * submit dispatches only the dirty fields' mutations (omnigraph mutations
 * require every declared param, so per-field mutations are the honest shape
 * for "send only what changed"). The field's submitted value arrives via
 * `{ $input: "<name>" }`. Identity params should use `{ $row: "<col>" }` —
 * resolved at dispatch against the prefill row actually being edited.
 * (`{ $state }` also works but resolves at render time, where a `default`
 * is silently dropped — prefer `$row` for edit-forms.)
 */
const FormFieldSchema = z
  .object({
    /** Field name — the `$input` key and the default prefill column. */
    name: z.string().min(1),
    /** Display label; defaults to `name`. */
    label: z.string().optional(),
    kind: z.enum([
      "text",
      "number",
      "select",
      "toggle",
      "textarea",
      "date",
      "picker",
    ]),
    /** Prefill column in the query's first row. Default: `name`. */
    column: z.string().min(1).optional(),
    /** Select options (select kind only). */
    options: z.array(z.string().min(1)).optional(),
    /**
     * Picker kind only: the catalog read whose rows become the options
     * (typeahead). The runtime reads it alongside the cell's main query.
     */
    options_query: OptionsQuerySchema.optional(),
    /** Picker: result column written as the field's value when picked. */
    value_column: z.string().min(1).optional(),
    /** Picker: display column; defaults to `value_column`. */
    label_column: z.string().min(1).optional(),
    /**
     * Submit is blocked while a required field is empty. Also the guard for
     * non-nullable params: an empty number field dispatches `null`, which
     * only a nullable server param accepts.
     */
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    placeholder: z.string().optional(),
    /**
     * Dispatched (only) when this field is dirty at submit — the edit-form
     * shape. Omit it when the form's `mutations` (form-level) consume this
     * field's value instead — the create-form shape.
     */
    mutation: MutationSpecSchema.optional(),
  })
  .superRefine((f, ctx) => {
    if (f.kind === "select" && (f.options?.length ?? 0) === 0) {
      ctx.addIssue({
        code: "custom",
        message: `select field '${f.name}' requires non-empty options`,
      });
    }
    if (f.kind === "picker") {
      if (f.options_query === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `picker field '${f.name}' requires options_query`,
        });
      }
      if (f.value_column === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `picker field '${f.name}' requires value_column`,
        });
      }
      if (f.options !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `picker field '${f.name}' must not declare static options`,
        });
      }
    } else if (
      f.options_query !== undefined ||
      f.value_column !== undefined ||
      f.label_column !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: `field '${f.name}': options_query/value_column/label_column require kind: picker`,
      });
    }
  });
export type FormField = z.infer<typeof FormFieldSchema>;

const FormPropsBase = z.object({
  fields: z.array(FormFieldSchema).min(1),
  /**
   * Form-level mutations, dispatched together on every submit (before any
   * dirty per-field mutations) with the full `$input` map — the create-form
   * shape, where one insert consumes several fields (e.g. `add_comment`
   * taking both `slug` and `text`), optionally followed by a second mutation
   * chaining off the same input (e.g. `link_comment`). Sequential independent
   * commits, same batch semantics as per-field mutations.
   */
  mutations: z.array(MutationSpecSchema).optional(),
  /** Submit button label; defaults to "Save". */
  submit_label: z.string().min(1).optional(),
  /**
   * Column identifying the prefill row. When its value changes (the user
   * picked a different entity), in-progress edits are reset — so a stale
   * edit can never dispatch against a new identity.
   */
  key_column: z.string().min(1).optional(),
  /** Shown when the prefill query returns no rows. */
  empty_text: z.string().optional(),
});

const checkFormProps = (
  p: { fields: { name: string; mutation?: unknown }[]; mutations?: unknown[] },
  ctx: z.RefinementCtx,
): void => {
  const seen = new Set<string>();
  for (const f of p.fields) {
    if (seen.has(f.name)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate form field name '${f.name}'`,
      });
    }
    seen.add(f.name);
  }
  // A form that can't write anything is authorable dead weight.
  const hasFieldMutation = p.fields.some((f) => f.mutation !== undefined);
  const hasFormMutations = (p.mutations?.length ?? 0) > 0;
  if (!hasFieldMutation && !hasFormMutations) {
    ctx.addIssue({
      code: "custom",
      message:
        "form declares no mutation: give fields per-field `mutation`s (edit-form) or the form-level `mutations` (create-form)",
    });
  }
};

export const FormAuthorPropsSchema = FormPropsBase.superRefine(checkFormProps);
export type FormAuthorProps = z.infer<typeof FormAuthorPropsSchema>;

export const FormRuntimePropsSchema = FormPropsBase.extend({
  /** Prefill result — fields initialize from `rows[0]` via `column`. */
  rows: z.array(z.record(z.string(), z.unknown())),
  /** Injected by the runtime (in-flight batch state, cell-scoped). */
  runtime: z
    .object({
      cell_id: z.string().min(1),
      saving: z.boolean(),
      /** Last batch failure, e.g. "set_priority: … (2/3 fields saved)". */
      error: z.string().optional(),
      /**
       * Seq of the last successful dispatch from this cell. A create-form
       * (no prefill row) remounts on change — clearing entered values after
       * a successful submit.
       */
      last_success_seq: z.number().optional(),
      /** Picker fields' option rows, keyed by field name (runtime-read). */
      field_options: z
        .record(z.string(), z.array(z.record(z.string(), z.unknown())))
        .optional(),
      /** Per-field options-read failures (cell stays healthy; stale rows kept). */
      field_options_errors: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
}).superRefine(checkFormProps);
export type FormRuntimeProps = z.infer<typeof FormRuntimePropsSchema>;

export const FormDescription =
  "Typed form over one entity: fields (text/number/select/toggle/textarea/date/picker — picker options come from a per-field `options_query` read, picked value = `value_column`) prefill from the query's first row (via `column`, default = field name) or start blank without a query. Two write shapes, combinable: per-field `mutation`s dispatch ONLY when their field is dirty (edit-form), and form-level `mutations` dispatch together on every submit (create-form — one insert consuming several fields). All run as one sequential batch (independent commits, stop at first error, one re-read). Field values resolve via `{ $input: name }`, identity via `{ $row: col }` (the prefill row). `key_column` resets edits when the prefill row's identity changes. A create-form clears its fields after a successful submit.";
