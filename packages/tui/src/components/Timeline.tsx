import React from "react";
import { Box, Text } from "ink";
import type { TimelineRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

function valueOf(row: Record<string, unknown>, col: string | undefined): string {
  if (!col) return "";
  const v = row[col];
  if (v === null || v === undefined) return "";
  return String(v);
}

export function Timeline({
  props: p,
}: ComponentCtx<TimelineRuntimeProps>): React.ReactElement {
  const { rows, actor_column, verb_column, target_column, timestamp_column, body_column } = p;
  if (rows.length === 0) {
    return (
      <Text dimColor italic>
        (no activity)
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      {rows.map((row, idx) => {
        const actor = valueOf(row, actor_column);
        const verb = valueOf(row, verb_column);
        const target = valueOf(row, target_column);
        const ts = valueOf(row, timestamp_column);
        const body = valueOf(row, body_column);
        return (
          <Box key={idx} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row" flexWrap="wrap">
              {actor && <Text bold>{actor} </Text>}
              {verb && <Text dimColor>{verb} </Text>}
              {target && <Text bold>{target}</Text>}
              {ts && <Text dimColor>{`  · ${ts}`}</Text>}
            </Box>
            {body && <Text>{body}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
