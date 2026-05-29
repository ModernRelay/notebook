import React, { useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { useActions, useStateValue } from "@json-render/ink";
import type { ActionListRuntimeProps } from "@omnigraph/catalog";

interface ComponentCtx<P> {
  props: P;
}

type ActionDescriptor = ActionListRuntimeProps["actions"][number];

/**
 * Focus-aware viewport. Visible row count is fixed; the window slides to
 * keep the focused row centered. Frame height stays constant regardless
 * of which row is focused — the terminal cursor pins at the bottom of
 * the frame and no whole-screen scroll churn happens on every Tab.
 */
const VISIBLE_ROWS = 7;

export function ActionList({
  props: p,
}: ComponentCtx<ActionListRuntimeProps>): React.ReactElement {
  const actions = useActions();
  const statusMap =
    useStateValue<Record<string, string>>(p.status_state ?? "/__never__") ?? {};

  const total = p.rows.length;
  const actionCount = p.actions.length;
  const [focusedRow, setFocusedRow] = useState(0);
  const [focusedAction, setFocusedAction] = useState(0);

  // Cell-level focus from Ink. Only intercept keys when the user has
  // tabbed into this cell; otherwise other cells'/global handlers see
  // arrows + Enter normally.
  const { isFocused: cellFocused } = useFocus({ autoFocus: true });

  useInput(
    (input, key) => {
      if (!cellFocused) return;

      if (key.upArrow) {
        setFocusedRow((r) => (total > 0 ? (r - 1 + total) % total : 0));
        return;
      }
      if (key.downArrow) {
        setFocusedRow((r) => (total > 0 ? (r + 1) % total : 0));
        return;
      }
      if (key.leftArrow) {
        setFocusedAction(
          (a) => (a - 1 + actionCount) % Math.max(1, actionCount),
        );
        return;
      }
      if (key.rightArrow) {
        setFocusedAction((a) => (a + 1) % Math.max(1, actionCount));
        return;
      }
      if (key.return || input === " ") {
        const row = p.rows[focusedRow];
        const act = p.actions[focusedAction];
        if (!row || !act) return;
        const id = String(row[p.id_column] ?? "");
        if (process.env.OMNIGRAPH_TUI_DEBUG) {
          process.stderr.write(
            `[debug] ActionList press: row=${focusedRow} action=${focusedAction} id=${id}\n`,
          );
        }
        fireAction(actions, act, id, p.runtime?.cell_id);
      }
    },
    { isActive: cellFocused },
  );

  if (total === 0) {
    return (
      <Text dimColor italic>
        (no items)
      </Text>
    );
  }

  // Compute window: keep focused row centered when possible.
  const half = Math.floor(VISIBLE_ROWS / 2);
  let start = Math.max(0, focusedRow - half);
  let end = Math.min(total, start + VISIBLE_ROWS);
  // Pin to the end if focus is near the bottom.
  if (end - start < VISIBLE_ROWS && start > 0) {
    start = Math.max(0, end - VISIBLE_ROWS);
  }
  const visible = p.rows.slice(start, end);

  return (
    <Box flexDirection="column">
      {/* Status / scroll header */}
      <Box>
        <Text dimColor>
          {focusedRow + 1} / {total}
          {!cellFocused && "  (Tab to enter)"}
        </Text>
      </Box>

      {start > 0 && (
        <Text dimColor>
          ↑ {start} more
        </Text>
      )}

      {visible.map((row, vIdx) => {
        const rowIdx = start + vIdx;
        const isRowFocused = rowIdx === focusedRow;
        const id = String(row[p.id_column] ?? "");
        const title = String(row[p.title_column] ?? "");
        const body = p.body_column
          ? String(row[p.body_column] ?? "")
          : "";
        const meta =
          p.meta_columns?.map((c) => String(row[c] ?? "")).filter(Boolean) ??
          [];
        const statusFromRow = p.status_field
          ? row[p.status_field]
          : undefined;
        const status =
          statusFromRow !== undefined && statusFromRow !== null
            ? String(statusFromRow)
            : id
              ? statusMap[id]
              : undefined;

        return (
          <Box
            key={id || rowIdx}
            flexDirection="column"
            marginTop={vIdx === 0 ? 0 : 0}
          >
            {/* Row header — title + status. Always one line. */}
            <Box>
              <Text bold={isRowFocused} color={isRowFocused ? "cyan" : undefined}>
                {isRowFocused ? "▶ " : "  "}
                {title}
              </Text>
              {status && (
                <Text color={statusColor(status)}> · {status}</Text>
              )}
            </Box>

            {/* Expand body + meta + buttons only on the focused row. */}
            {isRowFocused && body && (
              <Box marginLeft={4}>
                <Text dimColor>{body}</Text>
              </Box>
            )}
            {isRowFocused && meta.length > 0 && (
              <Box marginLeft={4}>
                <Text dimColor>{meta.join(" · ")}</Text>
              </Box>
            )}
            {isRowFocused && (
              <Box marginLeft={4}>
                {p.actions.map((act, aIdx) => (
                  <Text
                    key={`${aIdx}-${act.action ?? "mutate"}`}
                    color={
                      aIdx === focusedAction ? variantColor(act.variant) : undefined
                    }
                    bold={aIdx === focusedAction}
                  >
                    {aIdx === focusedAction ? "▶" : " "}[ {act.label} ]
                    {aIdx < p.actions.length - 1 ? "  " : ""}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        );
      })}

      {end < total && (
        <Text dimColor>
          ↓ {total - end} more
        </Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ row · ←/→ action · Enter to activate
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Dispatch one click. If the action descriptor carries a `mutation`, fire
 * the built-in `mutate` action with `{ ...mutation, target_id: id }`.
 * Otherwise fall back to the named state-only action.
 */
function fireAction(
  actions: ReturnType<typeof useActions>,
  act: ActionDescriptor,
  id: string,
  cellId?: string,
): void {
  if (act.mutation) {
    actions.execute({
      action: "mutate",
      params: { ...act.mutation, target_id: id, __cell_id: cellId },
    });
  } else if (act.action) {
    actions.execute({ action: act.action, params: { id } });
  }
}

function statusColor(status: string): string | undefined {
  if (status === "approved") return "green";
  if (status === "rejected") return "red";
  return undefined;
}

function variantColor(
  variant: ActionDescriptor["variant"],
): string | undefined {
  if (variant === "primary") return "green";
  if (variant === "danger") return "red";
  return undefined;
}
