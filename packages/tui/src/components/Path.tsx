import React from "react";
import { Box, Text } from "ink";
import type { PathRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

function valueOf(row: Record<string, unknown>, col: string | undefined): string {
  if (!col) return "";
  const v = row[col];
  if (v === null || v === undefined) return "";
  return String(v);
}

export function Path({
  props: p,
}: ComponentCtx<PathRuntimeProps>): React.ReactElement {
  const { steps, rows } = p;
  if (rows.length === 0) {
    return (
      <Text dimColor italic>
        (no path)
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      {rows.map((row, idx) => (
        <Box key={idx} flexDirection="row" flexWrap="wrap">
          {steps.map((step, sIdx) => {
            const from = valueOf(row, step.from_column);
            const predicate = valueOf(row, step.predicate_column);
            const to = valueOf(row, step.to_column);
            return (
              <React.Fragment key={sIdx}>
                {sIdx === 0 && <Text bold>{from}</Text>}
                <Text dimColor> ─{predicate}─▶ </Text>
                <Text bold>{to}</Text>
              </React.Fragment>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
