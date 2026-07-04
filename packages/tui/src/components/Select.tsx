import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { useBoundProp } from "@json-render/ink";
import type { SelectRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

export function Select({
  props: p,
  bindings,
}: ComponentCtx<SelectRuntimeProps>): React.ReactElement {
  const [value, setValue] = useBoundProp<string>(p.value, bindings?.value);
  const { isFocused } = useFocus();
  // Query-backed picker: rows are the options (values from value_column,
  // labels from label_column); static Selects use p.options as before.
  const rows = p.rows ?? [];
  const queryBacked = p.value_column !== undefined;
  const options = queryBacked
    ? rows
        .map((row) => String(row[p.value_column!] ?? ""))
        .filter((v) => v !== "")
    : (p.options ?? []);
  const labelFor = (v: string | undefined): string => {
    if (v === undefined || v === "") return "—";
    if (!queryBacked) return v;
    const row = rows.find((r) => String(r[p.value_column!] ?? "") === v);
    return row
      ? String(row[p.label_column ?? p.value_column!] ?? v)
      : v; // raw value on lookup miss (stale rows)
  };
  const idx = Math.max(0, options.indexOf(value ?? ""));

  useInput(
    (_input, key) => {
      if (!isFocused || options.length === 0) return;
      if (key.leftArrow) {
        const next = (idx - 1 + options.length) % options.length;
        setValue(options[next] ?? "");
      } else if (key.rightArrow) {
        const next = (idx + 1) % options.length;
        setValue(options[next] ?? "");
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box>
      <Text bold={isFocused}>
        {isFocused ? "▶ " : "  "}
        {p.label ? `${p.label}: ` : ""}
      </Text>
      <Text dimColor>‹ </Text>
      <Text bold={isFocused}>{labelFor(value)}</Text>
      <Text dimColor> ›</Text>
      {isFocused && (
        <Text dimColor> ({options.length === 0 ? 0 : idx + 1}/{options.length}, ←/→)</Text>
      )}
    </Box>
  );
}
