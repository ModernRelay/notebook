import React from "react";
import { Box, Text } from "ink";
import type { TableRuntimeProps } from "@modernrelay/notebook-core";

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

  // Compute display widths from header + each cell.
  const widths = columns.map((col) => {
    const cellWidth = (val: string) => Math.max(1, val.length);
    return Math.min(
      48,
      Math.max(
        cellWidth(col.label),
        ...rows.map((r) => cellWidth(formatCell(r[col.key], col.format))),
      ),
    );
  });
  const padCell = (val: string, width: number): string =>
    val.length >= width ? val.slice(0, width) : val + " ".repeat(width - val.length);

  return (
    <Box flexDirection="column">
      <Box>
        {columns.map((col, i) => (
          <Text key={col.key} bold>
            {padCell(col.label, widths[i] ?? col.label.length)}
            {i < columns.length - 1 ? "  " : ""}
          </Text>
        ))}
      </Box>
      {!dense && (
        <Text dimColor>
          {columns
            .map((col, i) =>
              "─".repeat(widths[i] ?? col.label.length).concat(
                i < columns.length - 1 ? "  " : "",
              ),
            )
            .join("")}
        </Text>
      )}
      {rows.length === 0 ? (
        <Text dimColor italic>
          (no rows)
        </Text>
      ) : (
        rows.map((row, rowIdx) => (
          <Box key={rowIdx}>
            {columns.map((col, i) => (
              <Text key={col.key}>
                {padCell(
                  formatCell(row[col.key], col.format),
                  widths[i] ?? col.label.length,
                )}
                {i < columns.length - 1 ? "  " : ""}
              </Text>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}
