import { z } from "zod";
import { MutationSpecSchema } from "../../spec/index.js";

export const ButtonRuntimePropsSchema = z.object({
  label: z.string().min(1),
  variant: z.enum(["default", "primary", "danger"]).optional(),
  /**
   * When set, pressing the button fires this mutation directly (non-row): its
   * `params` resolve from `$state`/literal at dispatch. Without it the button
   * just emits `press` for an `on.press` binding (today's behavior).
   */
  mutation: MutationSpecSchema.optional(),
  /**
   * Submit guard: state JSON-pointers that must each resolve to a non-empty
   * value before the button enables — so a mutation never fires with an unset
   * param.
   */
  requires: z.array(z.string().min(1)).optional(),
  /** Injected by the runtime for mutation buttons (cell id + in-flight state). */
  runtime: z
    .object({
      cell_id: z.string().optional(),
      saving: z.boolean().optional(),
      /** Parked warning from the last dispatch (e.g. a no-op write). */
      error: z.string().optional(),
    })
    .optional(),
});
export type ButtonRuntimeProps = z.infer<typeof ButtonRuntimePropsSchema>;

export const ButtonDescription =
  "Clickable button. With a `mutation` it fires a (non-row) write on press, guarded by `requires`; otherwise bind events via element.on (e.g. on.press = { action: 'approve', params: {...} }).";
