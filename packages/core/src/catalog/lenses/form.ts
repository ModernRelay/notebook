import { z } from "zod";
import { MutationSpecSchema } from "../../spec/index.js";

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
    kind: z.enum(["text", "number", "select", "toggle", "textarea", "date"]),
    /** Prefill column in the query's first row. Default: `name`. */
    column: z.string().min(1).optional(),
    /** Select options (select kind only). */
    options: z.array(z.string().min(1)).optional(),
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
    })
    .optional(),
}).superRefine(checkFormProps);
export type FormRuntimeProps = z.infer<typeof FormRuntimePropsSchema>;

export const FormDescription =
  "Typed form over one entity: fields (text/number/select/toggle/textarea/date) prefill from the query's first row (via `column`, default = field name) or start blank without a query. Two write shapes, combinable: per-field `mutation`s dispatch ONLY when their field is dirty (edit-form), and form-level `mutations` dispatch together on every submit (create-form — one insert consuming several fields). All run as one sequential batch (independent commits, stop at first error, one re-read). Field values resolve via `{ $input: name }`, identity via `{ $row: col }` (the prefill row). `key_column` resets edits when the prefill row's identity changes. A create-form clears its fields after a successful submit.";
