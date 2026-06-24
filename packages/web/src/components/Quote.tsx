import React from "react";
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
      <p className="text-sm italic text-muted-foreground">
        {p.empty_text ?? "(no quotes)"}
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {rows.map((row, idx) => {
        const text = valueOf(row, text_column);
        // Source first, then any extra metadata columns, joined by " · ".
        const cite = [source_column, ...(meta_columns ?? [])]
          .map((c) => valueOf(row, c))
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={idx}>
            <figure className="border-l-2 border-primary/40 pl-4">
              <blockquote className="max-w-prose whitespace-normal break-words text-sm leading-snug text-foreground">
                {text}
              </blockquote>
              {cite && (
                <figcaption className="mt-1.5 text-xs text-muted-foreground">
                  {cite}
                </figcaption>
              )}
            </figure>
          </li>
        );
      })}
    </ul>
  );
}
