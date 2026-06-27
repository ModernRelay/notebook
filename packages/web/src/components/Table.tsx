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
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

interface ComponentCtx<P> {
  props: P;
}

/** A column reads as numeric when every non-empty value parses as a number. */
function isNumericColumn(
  key: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): boolean {
  let sawValue = false;
  for (const row of rows) {
    const v = row[key];
    if (v === null || v === undefined || v === "") continue;
    sawValue = true;
    if (typeof v === "number") continue;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
      continue;
    return false;
  }
  return sawValue;
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

  // Numeric columns right-align (with tabular figures); authors can override.
  const alignByKey: Record<string, "left" | "right"> = {};
  for (const col of columns) {
    alignByKey[col.key] =
      col.align ?? (isNumericColumn(col.key, rows) ? "right" : "left");
  }

  return (
    <CossTable>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.key}
              className={cn(alignByKey[col.key] === "right" && "text-right")}
            >
              {col.label}
            </TableHead>
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
              {columns.map((col) => {
                const value = formatCell(row[col.key], col.format);
                const content = col.wrap ? (
                  <div className="max-w-prose leading-snug">{value}</div>
                ) : (
                  value
                );
                const alignRight = alignByKey[col.key] === "right";
                return (
                  <TableCell
                    key={col.key}
                    // Wrap by default (overriding the ui-kit's nowrap) so the
                    // w-full table always shrinks to its container. `wrap`
                    // columns cap line length (max-w-prose); `copy` columns get a
                    // copy-to-clipboard button revealed on cell hover; `badge`
                    // columns render the value as a chip (enums). Tables stay mono.
                    className={cn(
                      "group align-top whitespace-normal break-words font-mono text-xs",
                      alignRight && "text-right tabular-nums",
                      dense && "py-1",
                    )}
                  >
                    {col.badge ? (
                      value ? (
                        <Badge variant="secondary">{value}</Badge>
                      ) : null
                    ) : col.copy ? (
                      <span className="inline-flex items-start gap-1">
                        {content}
                        <CopyButton value={value} className="mt-0.5" />
                      </span>
                    ) : (
                      content
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </CossTable>
  );
}
