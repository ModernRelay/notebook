import React from "react";
import { useBoundProp } from "@json-render/react";
import type { SelectRuntimeProps } from "@modernrelay/notebook-core";
import {
  Select as SelectRoot,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityPicker } from "./EntityPicker.js";

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

  // Query-backed entity picker: rows are the options, rendered as a
  // searchable typeahead. Static-options Selects keep the plain dropdown.
  if (p.value_column !== undefined) {
    return (
      <label className="inline-flex w-full items-center gap-2 text-sm text-foreground">
        {p.label ? (
          <span className="shrink-0 text-muted-foreground">{p.label}</span>
        ) : null}
        <EntityPicker
          rows={p.rows ?? []}
          valueColumn={p.value_column}
          labelColumn={p.label_column}
          value={value ?? ""}
          onValueChange={setValue}
          placeholder={p.placeholder}
        />
      </label>
    );
  }

  const items = (p.options ?? []).map((opt) => ({
    label: opt === "" ? "— any —" : opt,
    value: toUi(opt),
  }));
  // The sentinel is only a real item when "" is among the options. With no ""
  // option and nothing selected, pass null so Base UI renders the placeholder
  // — mapping to the sentinel there would print the raw "__any__" string.
  const hasAnyOption = (p.options ?? []).includes("");
  const uiValue =
    value === undefined || value === ""
      ? hasAnyOption
        ? ANY
        : null
      : value;

  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground">
      {p.label ? <span className="text-muted-foreground">{p.label}</span> : null}
      <SelectRoot
        items={items}
        value={uiValue}
        onValueChange={(next) =>
          setValue(next == null ? "" : fromUi(String(next)))
        }
      >
        <SelectTrigger className="w-auto min-w-44">
          <SelectValue placeholder={p.placeholder ?? "Select…"} />
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
