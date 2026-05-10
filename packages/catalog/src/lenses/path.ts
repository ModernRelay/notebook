import { z } from "zod";

const StepSchema = z.object({
  from_column: z.string().min(1),
  predicate_column: z.string().min(1),
  to_column: z.string().min(1),
  label_column: z.string().optional(),
});
export type PathStep = z.infer<typeof StepSchema>;

export const PathAuthorPropsSchema = z.object({
  steps: z.array(StepSchema).min(1),
});
export type PathAuthorProps = z.infer<typeof PathAuthorPropsSchema>;

export const PathRuntimePropsSchema = PathAuthorPropsSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type PathRuntimeProps = z.infer<typeof PathRuntimePropsSchema>;

export const PathDescription =
  "Renders sequential path answers as A -p-> B -q-> C chains. Each row produces one chain; columns name the from/predicate/to/label of each step.";
