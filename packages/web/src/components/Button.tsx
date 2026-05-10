import React from "react";
import type { ButtonRuntimeProps } from "@omnigraph/catalog";

interface ComponentCtx<P> {
  props: P;
  emit: (event: string) => void;
}

const VARIANTS: Record<NonNullable<ButtonRuntimeProps["variant"]>, string> = {
  default:
    "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700",
  primary:
    "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500",
  danger:
    "bg-red-700 hover:bg-red-600 text-white border-red-600",
};

export function Button({
  props: p,
  emit,
}: ComponentCtx<ButtonRuntimeProps>): React.ReactElement {
  const cls = VARIANTS[p.variant ?? "default"];
  return (
    <button
      type="button"
      onClick={() => emit("press")}
      className={
        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors " +
        cls
      }
    >
      {p.label}
    </button>
  );
}
