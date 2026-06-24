import React from "react";
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
    return <p className="text-sm italic text-muted-foreground">(no activity)</p>;
  }
  return (
    <ol className="space-y-3">
      {rows.map((row, idx) => {
        const actor = valueOf(row, actor_column);
        const verb = valueOf(row, verb_column);
        const target = valueOf(row, target_column);
        const ts = valueOf(row, timestamp_column);
        const body = valueOf(row, body_column);
        return (
          <li key={idx} className="border-l-2 border-border pl-3">
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
              {actor && <span className="font-medium">{actor}</span>}
              {verb && <span className="text-muted-foreground">{verb}</span>}
              {target && <span className="font-medium">{target}</span>}
              {ts && (
                <span className="ml-auto text-xs text-muted-foreground">{ts}</span>
              )}
            </div>
            {body && (
              <p className="mt-1 rounded-md bg-muted px-3 py-2 text-sm">{body}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
