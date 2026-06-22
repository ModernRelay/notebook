import React from "react";
import { Box, Text } from "ink";
import type { CardRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function Card({
  props: p,
}: ComponentCtx<CardRuntimeProps>): React.ReactElement {
  const row = p.rows[0];
  if (!row) {
    return (
      <Text dimColor italic>
        {p.empty_text ?? "(nothing selected)"}
      </Text>
    );
  }
  const fields =
    p.fields ??
    Object.keys(row)
      .filter((k) => k !== p.title_column)
      .map((k) => ({ key: k, label: undefined as string | undefined }));
  const title = p.title_column ? fmt(row[p.title_column]) : "";
  return (
    <Box flexDirection="column">
      {title && <Text bold>{title}</Text>}
      {fields.map((f) => (
        <Box key={f.key} flexDirection="row">
          <Text dimColor>{f.label ?? f.key}: </Text>
          <Text>{fmt(row[f.key])}</Text>
        </Box>
      ))}
    </Box>
  );
}
