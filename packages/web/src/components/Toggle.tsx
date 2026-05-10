import React from "react";
import { useBoundProp } from "@json-render/react";
import type { ToggleRuntimeProps } from "@omnigraph/catalog";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

export function Toggle({
  props: p,
  bindings,
}: ComponentCtx<ToggleRuntimeProps>): React.ReactElement {
  const [value, setValue] = useBoundProp<boolean>(p.value, bindings?.value);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => setValue(e.target.checked)}
        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
      />
      <span>{p.label}</span>
    </label>
  );
}
