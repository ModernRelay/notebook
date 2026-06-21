import React from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { useBoundProp } from "@json-render/ink";
import type { ToggleRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

export function Toggle({
  props: p,
  bindings,
}: ComponentCtx<ToggleRuntimeProps>): React.ReactElement {
  const [value, setValue] = useBoundProp<boolean>(p.value, bindings?.value);
  const { isFocused } = useFocus();

  useInput(
    (input, key) => {
      if (!isFocused) return;
      if (input === " " || key.return) {
        setValue(!value);
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box>
      <Text bold={isFocused}>
        {isFocused ? "▶ " : "  "}[{value ? "x" : " "}] {p.label}
      </Text>
    </Box>
  );
}
