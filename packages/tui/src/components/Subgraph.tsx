import React from "react";
import { Box, Text } from "ink";
import type { SubgraphRuntimeProps } from "@modernrelay/notebook-catalog";

interface ComponentCtx<P> {
  props: P;
}

interface RowShape {
  centerId: string;
  centerLabel: string;
  predicate: string | null;
  neighbor: string | null;
}

export function Subgraph({
  props: p,
}: ComponentCtx<SubgraphRuntimeProps>): React.ReactElement {
  const { center, depth, rows } = p;
  if (rows.length === 0) {
    return (
      <Text dimColor italic>
        (no neighborhood)
      </Text>
    );
  }

  const shaped: RowShape[] = rows.map((r) => ({
    centerId: String(r[center.id_column] ?? ""),
    centerLabel: String(r[center.label_column] ?? ""),
    predicate: r.predicate !== undefined ? String(r.predicate) : null,
    neighbor: r.neighbor !== undefined ? String(r.neighbor) : null,
  }));

  const groups = new Map<string, RowShape[]>();
  for (const row of shaped) {
    const list = groups.get(row.centerId);
    if (list) list.push(row);
    else groups.set(row.centerId, [row]);
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {center.type} · depth {depth}
      </Text>
      {Array.from(groups.values()).map((group, idx) => {
        const head = group[0];
        if (!head) return null;
        return (
          <Box key={idx} flexDirection="column">
            <Text bold>● {head.centerLabel || head.centerId}</Text>
            {group.map((row, rIdx) => {
              if (row.predicate === null && row.neighbor === null) return null;
              return (
                <Box key={rIdx} marginLeft={2}>
                  <Text dimColor>─{row.predicate ?? "?"}─▶ </Text>
                  <Text>{row.neighbor ?? "?"}</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
