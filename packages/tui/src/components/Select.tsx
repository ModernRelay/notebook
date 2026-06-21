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
  const idx = Math.max(0, p.options.indexOf(value ?? ""));

  useInput(
    (_input, key) => {
      if (!isFocused) return;
      if (key.leftArrow) {
        const next = (idx - 1 + p.options.length) % p.options.length;
        setValue(p.options[next] ?? "");
      } else if (key.rightArrow) {
        const next = (idx + 1) % p.options.length;
        setValue(p.options[next] ?? "");
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
      <Text bold={isFocused}>{value ?? "—"}</Text>
      <Text dimColor> ›</Text>
      {isFocused && (
        <Text dimColor> ({idx + 1}/{p.options.length}, ←/→)</Text>
      )}
    </Box>
  );
}
