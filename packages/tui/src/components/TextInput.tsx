import React from "react";
import { Box, Text } from "ink";
import { useBoundProp } from "@json-render/ink";
import type { TextInputRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

/** Read-only in the TUI — the web is the input host; this shows the bound value. */
export function TextInput({
  props: p,
  bindings,
}: ComponentCtx<TextInputRuntimeProps>): React.ReactElement {
  const [value] = useBoundProp<string>(p.value, bindings?.value);
  return (
    <Box>
      {p.label && <Text>{p.label}: </Text>}
      <Text dimColor>{value || p.placeholder || "(set in the web UI)"}</Text>
    </Box>
  );
}
