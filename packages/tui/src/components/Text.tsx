import React from "react";
import { Box, Text as InkText } from "ink";
import type { TextRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

// Degraded fallback: the terminal renders the raw Markdown source (still
// readable) — no Markdown formatting in Ink.
export function Text({
  props: p,
}: ComponentCtx<TextRuntimeProps>): React.ReactElement {
  const row = p.rows[0];
  const body = row ? asText(row[p.text_column ?? ""]) : "";
  if (!row || body.trim() === "") {
    return (
      <InkText dimColor italic>
        {p.empty_text ?? "(no text)"}
      </InkText>
    );
  }
  const title = p.title_column ? asText(row[p.title_column]) : "";
  return (
    <Box flexDirection="column">
      {title && <InkText bold>{title}</InkText>}
      <InkText>{body}</InkText>
    </Box>
  );
}
