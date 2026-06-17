import React from "react";
import { useBoundProp } from "@json-render/react";
import type { SelectRuntimeProps } from "@modernrelay/notebook-catalog";
import {
  Select as SelectRoot,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

// The catalog uses "" to mean "no filter / any". Base UI's Select treats
// empty/null specially, so we map "" ↔ a private sentinel *inside the
// wrapper only* — the bound state still stores "" (notebook contract intact).
const ANY = "__any__";
const toUi = (v: string): string => (v === "" ? ANY : v);
const fromUi = (v: string): string => (v === ANY ? "" : v);

export function Select({
  props: p,
  bindings,
}: ComponentCtx<SelectRuntimeProps>): React.ReactElement {
  const [value, setValue] = useBoundProp<string>(p.value, bindings?.value);
  const items = p.options.map((opt) => ({
    label: opt === "" ? "— any —" : opt,
    value: toUi(opt),
  }));

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      {p.label && <span className="text-muted-foreground">{p.label}</span>}
      <SelectRoot
        items={items}
        value={toUi(value ?? "")}
        onValueChange={(next) => setValue(fromUi(String(next)))}
      >
        <SelectTrigger className="w-auto min-w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {items.map((it) => (
            <SelectItem key={it.value} value={it.value}>
              {it.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </SelectRoot>
    </label>
  );
}
