import React from "react";
import type { TableRuntimeProps } from "@modernrelay/notebook-catalog";
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
  const { columns, rows, dense } = p;
  if (rows.length === 0) {
    return <p className="text-sm italic text-muted-foreground">(no rows)</p>;
  }
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
        {rows.map((row, idx) => (
          <TableRow key={idx}>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                className={cn("font-mono text-xs", dense && "py-1")}
              >
                {formatCell(row[col.key], col.format)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </CossTable>
  );
}
