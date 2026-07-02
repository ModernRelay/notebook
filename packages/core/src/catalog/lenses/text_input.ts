import { z } from "zod";

export const TextInputRuntimePropsSchema = z.object({
  label: z.string().optional(),
  placeholder: z.string().optional(),
  /** When two-way bound via $bindState, this is read & written by the framework. */
  value: z.string().optional(),
});
export type TextInputRuntimeProps = z.infer<typeof TextInputRuntimePropsSchema>;

export const TextInputDescription =
  "Single-line text input. Two-way bind value to a state path via $bindState (e.g. value: { $bindState: '/draft/name' }); a Button mutation reads it via { $state }.";
