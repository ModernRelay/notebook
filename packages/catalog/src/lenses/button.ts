import { z } from "zod";

export const ButtonRuntimePropsSchema = z.object({
  label: z.string().min(1),
  variant: z.enum(["default", "primary", "danger"]).optional(),
});
export type ButtonRuntimeProps = z.infer<typeof ButtonRuntimePropsSchema>;

export const ButtonDescription =
  "Clickable button. Bind events via element.on (e.g. on.press = { action: 'approve', params: {...} }).";
