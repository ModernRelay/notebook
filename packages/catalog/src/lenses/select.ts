import { z } from "zod";

export const SelectRuntimePropsSchema = z.object({
  label: z.string().optional(),
  options: z.array(z.string()).min(1),
  /** When two-way bound via $bindState, this is read & written by the framework. */
  value: z.string().optional(),
});
export type SelectRuntimeProps = z.infer<typeof SelectRuntimePropsSchema>;

export const SelectDescription =
  "Single-selection dropdown / cycler. Two-way bind value to a state path via $bindState.";
