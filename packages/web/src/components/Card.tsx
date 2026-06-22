import React from "react";
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
      <p className="text-sm italic text-muted-foreground">
        {p.empty_text ?? "(nothing selected)"}
      </p>
    );
  }
  const fields =
    p.fields ??
    Object.keys(row)
      .filter((k) => k !== p.title_column)
      .map((k) => ({ key: k, label: undefined as string | undefined }));
  const title = p.title_column ? fmt(row[p.title_column]) : "";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {title && (
        <h3 className="mb-3 text-base font-semibold text-foreground">{title}</h3>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {fields.map((f) => (
          <React.Fragment key={f.key}>
            <dt className="text-muted-foreground">{f.label ?? f.key}</dt>
            <dd className="font-medium text-foreground">{fmt(row[f.key])}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}
