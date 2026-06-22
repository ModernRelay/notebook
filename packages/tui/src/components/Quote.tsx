import React from "react";
import { Box, Text } from "ink";
import type { QuoteRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

function valueOf(row: Record<string, unknown>, col: string | undefined): string {
  if (!col) return "";
  const v = row[col];
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function Quote({
  props: p,
}: ComponentCtx<QuoteRuntimeProps>): React.ReactElement {
  const { rows, text_column, source_column, meta_columns } = p;
  if (rows.length === 0) {
    return (
      <Text dimColor italic>
        {p.empty_text ?? "(no quotes)"}
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      {rows.map((row, idx) => {
        const text = valueOf(row, text_column);
        const cite = [source_column, ...(meta_columns ?? [])]
          .map((c) => valueOf(row, c))
          .filter(Boolean)
          .join(" · ");
        return (
          <Box key={idx} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row">
              <Text dimColor>{"┃ "}</Text>
              <Text>{text}</Text>
            </Box>
            {cite && <Text dimColor>{`  — ${cite}`}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
