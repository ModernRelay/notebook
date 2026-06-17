import React from "react";
import type { PathRuntimeProps } from "@omnigraph/catalog";

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
    return <p className="text-sm italic text-muted-foreground">(no path)</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((row, idx) => (
        <li
          key={idx}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          {steps.map((step, sIdx) => {
            const from = valueOf(row, step.from_column);
            const predicate = valueOf(row, step.predicate_column);
            const to = valueOf(row, step.to_column);
            return (
              <React.Fragment key={sIdx}>
                {sIdx === 0 && <Node>{from}</Node>}
                <Predicate>{predicate}</Predicate>
                <Node>{to}</Node>
              </React.Fragment>
            );
          })}
        </li>
      ))}
    </ul>
  );
}

function Node({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="rounded-md bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
      {children}
    </span>
  );
}

function Predicate({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span className="font-mono text-xs text-muted-foreground">─{children}─▶</span>
  );
}
