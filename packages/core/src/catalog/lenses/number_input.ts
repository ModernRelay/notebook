import { z } from "zod";

export const NumberInputRuntimePropsSchema = z.object({
  label: z.string().optional(),
  placeholder: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  /** When two-way bound via $bindState, this is read & written by the framework. */
  value: z.number().optional(),
});
export type NumberInputRuntimeProps = z.infer<
  typeof NumberInputRuntimePropsSchema
>;

export const NumberInputDescription =
  "Numeric input. Two-way bind value to a state path via $bindState; a Button mutation reads it via { $state }.";
