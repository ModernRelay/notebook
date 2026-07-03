import React from "react";
import { Box, Text } from "ink";
import { useBoundProp } from "@json-render/ink";
import type { NumberInputRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
  bindings?: Record<string, string>;
}

/** Read-only in the TUI — the web is the input host; this shows the bound value. */
export function NumberInput({
  props: p,
  bindings,
}: ComponentCtx<NumberInputRuntimeProps>): React.ReactElement {
  const [value] = useBoundProp<number>(p.value, bindings?.value);
  return (
    <Box>
      {p.label && <Text>{p.label}: </Text>}
      <Text dimColor>
        {value === undefined ? p.placeholder || "(set in the web UI)" : String(value)}
      </Text>
    </Box>
  );
}
