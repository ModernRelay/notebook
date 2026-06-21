import React from "react";
import { useBoundProp } from "@json-render/react";
import type { ToggleRuntimeProps } from "@modernrelay/notebook-core";
import { Switch } from "@/components/ui/switch";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

export function Toggle({
  props: p,
  bindings,
}: ComponentCtx<ToggleRuntimeProps>): React.ReactElement {
  // Two-way binding preserved: $bindState resolves to props.value + bindings.value.
  const [value, setValue] = useBoundProp<boolean>(p.value, bindings?.value);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <Switch
        checked={Boolean(value)}
        onCheckedChange={(checked) => setValue(Boolean(checked))}
      />
      <span>{p.label}</span>
    </label>
  );
}
