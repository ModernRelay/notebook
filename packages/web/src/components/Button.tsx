import React from "react";
import type { ButtonRuntimeProps } from "@modernrelay/notebook-catalog";
import { Button as CossButton } from "@/components/ui/button";

interface ComponentCtx<P> {
  props: P;
  emit: (event: string) => void;
}

// Catalog variant vocabulary → COSS Button variants.
const VARIANT: Record<
  NonNullable<ButtonRuntimeProps["variant"]>,
  "default" | "destructive" | "outline"
> = {
  default: "outline",
  primary: "default",
  danger: "destructive",
};

export function Button({
  props: p,
  emit,
}: ComponentCtx<ButtonRuntimeProps>): React.ReactElement {
  return (
    <CossButton
      variant={VARIANT[p.variant ?? "default"]}
      size="sm"
      onClick={() => emit("press")}
    >
      {p.label}
    </CossButton>
  );
}
