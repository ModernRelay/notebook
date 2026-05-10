import { z } from "zod";

export const ToggleRuntimePropsSchema = z.object({
  label: z.string().min(1),
  /** When two-way bound via $bindState, this is read & written by the framework. */
  value: z.boolean().optional(),
});
export type ToggleRuntimeProps = z.infer<typeof ToggleRuntimePropsSchema>;

export const ToggleDescription =
  "Boolean toggle. Two-way bind to a state path via $bindState (e.g. value: { $bindState: '/filters/show_only_open' }).";
