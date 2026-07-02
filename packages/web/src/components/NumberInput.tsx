import React from "react";
import { useBoundProp } from "@json-render/react";
import type { NumberInputRuntimeProps } from "@modernrelay/notebook-core";
import { Input } from "@/components/ui/input";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

export function NumberInput({
  props: p,
  bindings,
}: ComponentCtx<NumberInputRuntimeProps>): React.ReactElement {
  // Two-way bound to a state path via $bindState; the bound value is a number
  // (empty input → undefined). A Button mutation reads it via { $state }.
  // NOTE: a controlled type=number echoes the parsed value, so an in-progress
  // entry like "-" or "1." is normalized away mid-typing. Integers round-trip
  // cleanly; free-form decimal/negative entry is a follow-up (a text buffer with
  // inputMode="decimal", which would trade away the native min/max/step spinner).
  const [value, setValue] = useBoundProp<number | undefined>(
    p.value,
    bindings?.value,
  );
  return (
    <label className="inline-flex w-full items-center gap-2 text-sm text-foreground">
      {p.label ? (
        <span className="shrink-0 text-muted-foreground">{p.label}</span>
      ) : null}
      <Input
        type="number"
        value={value ?? ""}
        placeholder={p.placeholder}
        aria-label={p.label ? undefined : p.placeholder}
        min={p.min}
        max={p.max}
        step={p.step}
        onChange={(e) => {
          if (e.target.value === "") return setValue(undefined);
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) setValue(n);
        }}
      />
    </label>
  );
}
