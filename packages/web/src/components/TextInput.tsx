import React from "react";
import { useBoundProp } from "@json-render/react";
import type { TextInputRuntimeProps } from "@modernrelay/notebook-core";
import { Input } from "@/components/ui/input";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

export function TextInput({
  props: p,
  bindings,
}: ComponentCtx<TextInputRuntimeProps>): React.ReactElement {
  // Two-way bound to a state path via $bindState (like Select/Toggle). A Button
  // mutation reads the value via { $state: <path> }.
  const [value, setValue] = useBoundProp<string>(p.value, bindings?.value);
  return (
    <label className="inline-flex w-full items-center gap-2 text-sm text-foreground">
      {p.label ? (
        <span className="shrink-0 text-muted-foreground">{p.label}</span>
      ) : null}
      <Input
        value={value ?? ""}
        placeholder={p.placeholder}
        aria-label={p.label ? undefined : p.placeholder}
        onChange={(e) => setValue(e.target.value)}
      />
    </label>
  );
}
