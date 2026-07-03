import { z } from "zod";
import { MutationSpecSchema } from "../../spec/index.js";

const ActionDescriptorSchema = z
  .object({
    /** Visible label for the per-row button. */
    label: z.string().min(1),
    /**
     * Name of an action registered in the renderer's action map. Used when
     * `mutation` is NOT set; the lens fires `actions.execute({ action, params: { id } })`.
     */
    action: z.string().min(1).optional(),
    /** Visual variant. Same vocabulary as Button. */
    variant: z.enum(["default", "primary", "danger"]).optional(),
    /**
     * Declarative mutation spec mirroring a cell `query`: `ref` (server-owned
     * catalog mutation) XOR `rawGq` (inline escape hatch), plus typed `params`
     * (literals / `{ $row: col }` / `{ $state: ptr }`) and an optional
     * `optimistic` overlay. When set, the lens fires the built-in `mutate`
     * action with the clicked row; one atomic commit per click.
     */
    mutation: MutationSpecSchema.optional(),
  })
  .refine(
    (a) => Boolean(a.action) || Boolean(a.mutation),
    "each ActionList action descriptor needs either `action` or `mutation`",
  );

export const ActionListAuthorPropsSchema = z.object({
  /** Column whose value identifies each row (passed as `{ id }` to actions). */
  id_column: z.string().min(1),
  /** Column whose value is the row's headline. */
  title_column: z.string().min(1),
  /** Optional secondary text per row. */
  body_column: z.string().optional(),
  /** Additional fields to display as a metadata strip below the title. */
  meta_columns: z.array(z.string()).optional(),
  /** One or more actions, each rendered as a button per row. */
  actions: z.array(ActionDescriptorSchema).min(1),
  /**
   * Column whose value is shown as the row's status badge — typically the
   * field that mutation actions write to (e.g. "status"). Preferred over
   * `status_state` for actions that mutate persistent data.
   */
  status_field: z.string().optional(),
  /**
   * State path holding a `Record<id, string>` of per-row outcomes. Used
   * for ephemeral, non-persistent UI feedback; legacy path. New cells
   * should prefer `status_field` with a real mutation.
   */
  status_state: z.string().optional(),
});
export type ActionListAuthorProps = z.infer<typeof ActionListAuthorPropsSchema>;

export const ActionListRuntimePropsSchema = ActionListAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
  runtime: z
    .object({
      cell_id: z.string().min(1),
      mutation_state: z
        .record(
          z.string(),
          z.object({
            saving: z.boolean(),
            error: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
export type ActionListRuntimeProps = z.infer<typeof ActionListRuntimePropsSchema>;

export const ActionListDescription =
  "List of items where each row carries inline action buttons. A mutation with `confirm` (true or an armed-label string) requires a second click to fire — the inline destructive guard; `optimistic: { remove: true }` hides the row while a delete is in flight (restored if the write fails or matches nothing). Each action descriptor declares either a named `action` (state-only, fires with `{ id: row[id_column] }`) or a declarative `mutation` — a `ref` catalog mutation or `rawGq` escape hatch with typed `params` (`{ $row: col }` pulls the clicked row's column, `{ $state: ptr }` reads state) and an optional `optimistic` overlay. Optional `status_field` reads the row's status from the data; `status_state` from a state path.";
