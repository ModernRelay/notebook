import React from "react";
import type { CardRuntimeProps } from "@modernrelay/notebook-core";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import { useAnnotation } from "../annotation-context.js";
import { AnnotationMarker } from "./AnnotationMarker.js";

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
  const annot = useAnnotation();
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
      .map((k) => ({
        key: k,
        label: undefined as string | undefined,
        copy: false,
        badge: false,
      }));
  const title = p.title_column ? fmt(row[p.title_column]) : "";
  const akey =
    title || (fields[0] ? fmt(row[fields[0].key]) : "") || "card";
  const n = annot.numberOf(akey);
  // Frameless: the cell card is the only frame (no inner border/padding).
  return (
    <div
      className={cn(annot.active && "cursor-crosshair")}
      {...(annot.active
        ? {
            onClick: (e: React.MouseEvent) =>
              annot.annotate(
                { key: akey, headline: title || akey, data: row },
                e,
              ),
          }
        : {})}
    >
      {title && (
        <h3 className="mb-3 flex items-center gap-1.5 text-base font-semibold text-foreground">
          {n !== null && <AnnotationMarker n={n} />}
          {title}
        </h3>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {fields.map((f) => {
          const value = fmt(row[f.key]);
          return (
            <React.Fragment key={f.key}>
              <dt className="text-muted-foreground">{f.label ?? f.key}</dt>
              <dd className="group font-medium text-foreground">
                {f.badge ? (
                  value ? <Badge variant="secondary">{value}</Badge> : null
                ) : f.copy ? (
                  <span className="inline-flex items-center gap-1">
                    {value}
                    <CopyButton value={value} />
                  </span>
                ) : (
                  value
                )}
              </dd>
            </React.Fragment>
          );
        })}
      </dl>
    </div>
  );
}
