import React from "react";
import type { TableRuntimeProps } from "@omnigraph/catalog";

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
    return <p className="italic text-zinc-500">(no rows)</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 text-left font-medium text-zinc-300"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={idx}
              className={
                "border-b border-zinc-900 last:border-b-0 " +
                (idx % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/40")
              }
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={
                    (dense ? "px-2 py-1 " : "px-3 py-2 ") +
                    "align-top text-zinc-200 font-mono text-xs"
                  }
                >
                  {formatCell(row[col.key], col.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
