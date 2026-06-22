import React from "react";
import { useActions, useStateValue } from "@json-render/react";
import type { TableRuntimeProps } from "@modernrelay/notebook-core";
import {
  Table as CossTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface ComponentCtx<P> {
  props: P;
}

function formatCell(
  value: unknown,
  format: TableRuntimeProps["columns"][number]["format"],
): string {
  if (value === null || value === undefined) return "";
  if (format === "json") return JSON.stringify(value);
  if (format === "number") {
    return typeof value === "number" ? value.toString() : String(value);
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function Table({
  props: p,
}: ComponentCtx<TableRuntimeProps>): React.ReactElement {
  const { columns, rows, dense, select_state, select_column } = p;
  const actions = useActions();
  // Read the current selection so we can highlight the active row.
  const selected = useStateValue<string>(select_state ?? "/__never__");

  if (rows.length === 0) {
    return <p className="text-sm italic text-muted-foreground">(no rows)</p>;
  }

  // Rows are clickable only when the author opts in with both props.
  const selectable = Boolean(select_state && select_column);
  const rowValue = (row: Record<string, unknown>): string =>
    select_column ? String(row[select_column] ?? "") : "";

  return (
    <CossTable>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key}>{col.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, idx) => {
          const isSelected = selectable && rowValue(row) === selected;
          return (
            <TableRow
              key={idx}
              className={cn(
                selectable && "cursor-pointer hover:bg-muted/50",
                isSelected && "bg-accent",
              )}
              {...(selectable
                ? {
                    onClick: () =>
                      actions.execute({
                        action: "setState",
                        params: { statePath: select_state, value: rowValue(row) },
                      }),
                  }
                : {})}
            >
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  // Wrap by default (overriding the ui-kit's nowrap) so the
                  // w-full table always shrinks to its container — vital inside
                  // the narrow side drawer, where a long value would otherwise
                  // force horizontal overflow. Auto table-layout still hands the
                  // longer column more width. `wrap` columns additionally cap
                  // their line length (max-w-prose) for readable prose.
                  className={cn(
                    "align-top whitespace-normal break-words font-mono text-xs",
                    dense && "py-1",
                  )}
                >
                  {col.wrap ? (
                    <div className="max-w-prose leading-snug">
                      {formatCell(row[col.key], col.format)}
                    </div>
                  ) : (
                    formatCell(row[col.key], col.format)
                  )}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </CossTable>
  );
}
