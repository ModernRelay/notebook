import React from "react";
import { Box, Text } from "ink";
import type { FormRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/**
 * Read-only terminal rendering of a Form: the prefill row's current values,
 * one line per field. Editing/submitting is a web-shell affordance (Ink text
 * entry is a heavier lift — host-shell parity note, like `width`/`color`).
 */
export function Form({
  props: p,
}: ComponentCtx<FormRuntimeProps>): React.ReactElement {
  const row = p.rows[0];
  if (!row && p.key_column !== undefined) {
    return (
      <Text dimColor italic>
        {p.empty_text ?? "(nothing to edit)"}
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      {p.fields.map((f) => (
        <Box key={f.name} flexDirection="row">
          <Text dimColor>{f.label ?? f.name}: </Text>
          <Text>{fmt(row?.[f.column ?? f.name])}</Text>
        </Box>
      ))}
      <Text dimColor italic>
        (read-only in the terminal — submit from the web UI)
      </Text>
    </Box>
  );
}
