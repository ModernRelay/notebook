import React from "react";
import { useBoundProp } from "@json-render/react";
import type { SelectRuntimeProps } from "@omnigraph/catalog";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

export function Select({
  props: p,
  bindings,
}: ComponentCtx<SelectRuntimeProps>): React.ReactElement {
  const [value, setValue] = useBoundProp<string>(p.value, bindings?.value);
  return (
    <label className="inline-flex items-center gap-2 text-sm text-zinc-200">
      {p.label && <span className="text-zinc-400">{p.label}</span>}
      <select
        value={value ?? ""}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        {p.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === "" ? "— any —" : opt}
          </option>
        ))}
      </select>
    </label>
  );
}
