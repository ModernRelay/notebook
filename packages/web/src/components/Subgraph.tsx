import React from "react";
import type { SubgraphRuntimeProps } from "@modernrelay/notebook-core";
import { cn } from "@/lib/utils";
import { useAnnotation } from "../annotation-context.js";
import { AnnotationMarker } from "./AnnotationMarker.js";

interface ComponentCtx<P> {
  props: P;
}

interface Group {
  centerId: string;
  centerLabel: string;
  edges: Array<{ predicate: string | null; neighbor: string | null }>;
}

export function Subgraph({
  props: p,
}: ComponentCtx<SubgraphRuntimeProps>): React.ReactElement {
  const { center, depth, rows } = p;
  const annot = useAnnotation();
  if (rows.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">(no neighborhood)</p>
    );
  }

  const groups = new Map<string, Group>();
  for (const r of rows) {
    const id = String(r[center.id_column] ?? "");
    const label = String(r[center.label_column] ?? "");
    const predicate = r.predicate !== undefined ? String(r.predicate) : null;
    const neighbor = r.neighbor !== undefined ? String(r.neighbor) : null;
    const existing = groups.get(id);
    if (existing) existing.edges.push({ predicate, neighbor });
    else
      groups.set(id, {
        centerId: id,
        centerLabel: label,
        edges: [{ predicate, neighbor }],
      });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {center.type} · depth {depth}
      </p>
      {[...groups.values()].map((g) => {
        const annotated = annot.active && annot.isAnnotated(g.centerId);
        return (
          <div key={g.centerId} className="space-y-1">
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm font-semibold text-foreground",
                annot.active && "cursor-crosshair",
              )}
              {...(annot.active
                ? {
                    onClick: (e: React.MouseEvent) =>
                      annot.annotate(
                        {
                          key: g.centerId,
                          headline: g.centerLabel || g.centerId,
                          data: {
                            [center.id_column]: g.centerId,
                            [center.label_column]: g.centerLabel,
                            type: center.type,
                          },
                        },
                        e,
                      ),
                  }
                : {})}
            >
              {annotated ? <AnnotationMarker /> : <span>●</span>}
              {g.centerLabel || g.centerId}
            </p>
            <ul className="ml-3 space-y-0.5 text-sm">
              {g.edges.map((e, idx) => {
                if (e.predicate === null && e.neighbor === null) return null;
                return (
                  <li
                    key={idx}
                    className="flex items-center gap-2 text-foreground"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      ─{e.predicate ?? "?"}─▶
                    </span>
                    <span className="font-medium">{e.neighbor ?? "?"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
