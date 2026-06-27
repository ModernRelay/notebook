import React, { useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { useActions, useStateValue } from "@json-render/ink";
import type { TableRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

// Focus-aware viewport for selectable tables — keeps the frame bounded the same
// way the ActionList does. Non-selectable tables render every row as before.
const VISIBLE_ROWS = 10;

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
  // Rows are selectable only when the author opts in with both props — same
  // contract as the web Table. Hooks below are always called (React rules) and
  // simply stay inert when not selectable.
  const selectable = Boolean(select_state && select_column);

  const actions = useActions();
  const { isFocused } = useFocus({ autoFocus: selectable });
  const selected = useStateValue<string>(select_state ?? "/__never__");
  const [focusedRow, setFocusedRow] = useState(0);

  const total = rows.length;
  const rowValue = (row: Record<string, unknown>): string =>
    select_column ? String(row[select_column] ?? "") : "";

  useInput(
    (input, key) => {
      if (!selectable) return;
      if (key.upArrow) {
        setFocusedRow((r) => (total > 0 ? (r - 1 + total) % total : 0));
        return;
      }
      if (key.downArrow) {
        setFocusedRow((r) => (total > 0 ? (r + 1) % total : 0));
        return;
      }
      if (key.return || input === " ") {
        const row = rows[focusedRow];
        if (!row || !select_state) return;
        // Write the row's select_column value to state via the same `setState`
        // action the ink registry wires — a dependent cell reading `$state`
        // re-resolves in place.
        actions.execute({
          action: "setState",
          params: { statePath: select_state, value: rowValue(row) },
        });
      }
    },
    { isActive: selectable && isFocused },
  );

  // Column widths from header + every row (stable across the viewport).
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
  const gutter = selectable ? "  " : "";

  // Sliding window centered on the focused row (selectable + long tables only).
  let start = 0;
  let end = total;
  if (selectable && total > VISIBLE_ROWS) {
    const half = Math.floor(VISIBLE_ROWS / 2);
    start = Math.max(0, focusedRow - half);
    end = Math.min(total, start + VISIBLE_ROWS);
    if (end - start < VISIBLE_ROWS && start > 0) {
      start = Math.max(0, end - VISIBLE_ROWS);
    }
  }
  const visible = rows.slice(start, end);

  return (
    <Box flexDirection="column">
      <Box>
        {selectable && <Text bold>{gutter}</Text>}
        {columns.map((col, i) => (
          <Text key={col.key} bold>
            {padCell(col.label, widths[i] ?? col.label.length)}
            {i < columns.length - 1 ? "  " : ""}
          </Text>
        ))}
      </Box>
      {!dense && (
        <Text dimColor>
          {gutter +
            columns
              .map((col, i) =>
                "─".repeat(widths[i] ?? col.label.length).concat(
                  i < columns.length - 1 ? "  " : "",
                ),
              )
              .join("")}
        </Text>
      )}
      {total === 0 ? (
        <Text dimColor italic>
          (no rows)
        </Text>
      ) : (
        <>
          {selectable && start > 0 && <Text dimColor>↑ {start} more</Text>}
          {visible.map((row, vIdx) => {
            const rowIdx = start + vIdx;
            const isRowFocused = selectable && rowIdx === focusedRow;
            const isRowSelected = selectable && rowValue(row) === selected;
            const marker = isRowFocused ? "▶ " : isRowSelected ? "● " : "  ";
            const color = isRowFocused
              ? "cyan"
              : isRowSelected
                ? "green"
                : undefined;
            return (
              <Box key={rowIdx}>
                {selectable && (
                  <Text color={color} bold={isRowFocused}>
                    {marker}
                  </Text>
                )}
                {columns.map((col, i) => (
                  <Text key={col.key} color={color} bold={isRowFocused}>
                    {padCell(
                      formatCell(row[col.key], col.format),
                      widths[i] ?? col.label.length,
                    )}
                    {i < columns.length - 1 ? "  " : ""}
                  </Text>
                ))}
              </Box>
            );
          })}
          {selectable && end < total && (
            <Text dimColor>↓ {total - end} more</Text>
          )}
        </>
      )}
      {selectable && (
        <Box marginTop={1}>
          <Text dimColor>
            ↑/↓ select · Enter{!isFocused ? "  (Tab to enter)" : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
}
