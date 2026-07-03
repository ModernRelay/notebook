import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { JSONUIProvider, Renderer } from "@json-render/ink";
import type { Notebook } from "@modernrelay/notebook-core";
import {
  createNotebookRuntime,
  type CellExecution,
  type RuntimeSnapshot,
  type Source,
} from "@modernrelay/notebook-core";
import { inkRegistry } from "./registry.js";

interface AppProps {
  notebook: Notebook;
  source: Source;
  /** Header label: server URL or fixture path. */
  label: string;
  /** Exit immediately after the notebook finishes (used in non-TTY runs). */
  autoExit?: boolean;
}

type Status =
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "fatal"; message: string };

/**
 * One-cell-per-screen TUI. Tab strip at top shows all cells, active cell
 * fills the remaining viewport. `[` / `]` cycle cells; `1`-`9` jump.
 *
 * This avoids the "Tab redraws a tall notebook and the terminal scrolls"
 * problem entirely — only the active cell is in the rendered frame, so
 * the frame stays bounded and predictable.
 */
export function App({
  notebook,
  source,
  label,
  autoExit = false,
}: AppProps): React.ReactElement {
  const [runtime] = useState(() =>
    createNotebookRuntime({ notebook, source }),
  );
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(() =>
    runtime.getSnapshot(),
  );
  const [activeCell, setActiveCell] = useState(0);
  const { exit } = useApp();
  const status: Status =
    snapshot.status === "fatal"
      ? { kind: "fatal", message: snapshot.error ?? "runtime failed" }
      : snapshot.status === "ready"
        ? { kind: "done" }
        : { kind: "running" };

  const cells = snapshot.cells;
  const cellCount = cells.length;

  useInput((input) => {
    if (input === "q") {
      exit();
      return;
    }
    if (cellCount === 0) return;
    if (input === "[") {
      setActiveCell((c) => (c - 1 + cellCount) % cellCount);
      return;
    }
    if (input === "]") {
      setActiveCell((c) => (c + 1) % cellCount);
      return;
    }
    if (input >= "1" && input <= "9") {
      const idx = parseInt(input, 10) - 1;
      if (idx >= 0 && idx < cellCount) setActiveCell(idx);
    }
  });

  const handleStateChange = useCallback(
    (changes: Array<{ path: string; value: unknown }>) => {
      if (process.env.OMNIGRAPH_TUI_DEBUG) {
        process.stderr.write(
          `[debug] onStateChange: ${changes.map((c) => `${c.path}=${JSON.stringify(c.value)}`).join(", ")}\n`,
        );
      }
      runtime.applyStateChanges(changes);
    },
    [runtime],
  );

  const handlers = useMemo(
    () => ({
      mutate: async (params: Record<string, unknown>) => {
        if (process.env.OMNIGRAPH_TUI_DEBUG) {
          process.stderr.write(
            `[debug] mutate handler entered: ${JSON.stringify(params)}\n`,
          );
        }
        await runtime.dispatch("mutate", { params });
      },
    }),
    [runtime],
  );

  useEffect(() => {
    const unsubscribe = runtime.subscribe(() => setSnapshot(runtime.getSnapshot()));
    return () => {
      unsubscribe();
      runtime.dispose();
    };
  }, [runtime]);

  useEffect(() => {
    if (autoExit && (snapshot.status === "ready" || snapshot.status === "fatal")) {
      setTimeout(() => exit(), 200);
    }
  }, [autoExit, exit, snapshot.finishedAt, snapshot.status]);

  // Clamp active cell when count changes (e.g. notebook reload).
  const safeActive = Math.min(activeCell, Math.max(0, cellCount - 1));

  return (
    <JSONUIProvider
      initialState={{}}
      onStateChange={handleStateChange}
      handlers={handlers}
    >
      <Box flexDirection="column">
        {/* Header: notebook title + source label */}
        <Box>
          <Text bold>{notebook.title}</Text>
          <Text dimColor> · </Text>
          <Text dimColor>{label}</Text>
        </Box>

        {/* Tab strip: all cells, active highlighted. The TUI is layout-flat —
            it ignores a cell's `width` and `tab` (web-only view tiers) and lists
            every cell inline; the active cell shows its `tab` as a label. */}
        {cellCount > 0 && (
          <Box marginTop={1}>
            {cells.map((c, i) => (
              <CellTab
                key={c.cell.id}
                index={i}
                cell={c}
                isActive={i === safeActive}
                isLast={i === cellCount - 1}
              />
            ))}
          </Box>
        )}

        {/* Status while loading */}
        {status.kind === "running" && (
          <Box marginTop={1}>
            <Text dimColor>running…</Text>
          </Box>
        )}
        {status.kind === "fatal" && (
          <Box marginTop={1}>
            <Text color="red">fatal: {status.message}</Text>
          </Box>
        )}

        {/* Active cell only */}
        {status.kind === "done" && cells[safeActive] && (
          <Box marginTop={1} flexDirection="column">
            <ActiveCellView cell={cells[safeActive]!} />
          </Box>
        )}

        {snapshot.mutationError !== null && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red">mutation error</Text>
            <Text color="red" dimColor>
              {condenseMutationError(snapshot.mutationError)}
            </Text>
          </Box>
        )}

        {snapshot.mutationError === null &&
          snapshot.mutationFeedback !== null && (
            <Box marginTop={1}>
              <Text color="green">✓ {snapshot.mutationFeedback.message}</Text>
            </Box>
          )}

        <ApprovalsFooter state={snapshot.state} />

        {/* Footer: nav keys */}
        {!autoExit && (
          <Box marginTop={1}>
            <Text dimColor>
              [ / ] prev/next cell · 1-{Math.min(9, Math.max(1, cellCount))} jump · q quit
            </Text>
          </Box>
        )}
      </Box>
    </JSONUIProvider>
  );
}

function CellTab({
  index,
  cell,
  isActive,
  isLast,
}: {
  index: number;
  cell: CellExecution;
  isActive: boolean;
  isLast: boolean;
}): React.ReactElement {
  const id = cell.cell.id;
  return (
    <>
      <Text bold={isActive} color={isActive ? "cyan" : undefined} dimColor={!isActive}>
        [{index + 1}] {id}
      </Text>
      {!isLast && <Text dimColor>   </Text>}
    </>
  );
}

function ActiveCellView({
  cell,
}: {
  cell: CellExecution;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{cell.cell.id} </Text>
        <Text dimColor>{cell.cell.lens}</Text>
        {cell.cell.tab && <Text dimColor> · {cell.cell.tab}</Text>}
        {cell.error === null && cell.result !== null && (
          <Text dimColor>
            {" "}
            · {cell.result.row_count} row(s) · {cell.durationMs}ms
          </Text>
        )}
        {cell.pending && <Text color="cyan"> · updating…</Text>}
      </Box>

      {/* Inline controls (filter Selects, Toggles, action Buttons) — render
          ABOVE the lens. Each is a one-line dispatched json-render spec. */}
      {cell.controlSpecs.length > 0 && (
        <Box marginTop={1} marginLeft={1} flexDirection="column">
          {cell.controlSpecs.map((spec) => (
            <Box key={spec.root}>
              <Renderer spec={spec} registry={inkRegistry} />
            </Box>
          ))}
        </Box>
      )}

      {cell.error !== null && (
        <Text color="red">{cell.error.message}</Text>
      )}
      {/* Keep the last good lens visible even on a failed re-read
          (stale-while-revalidate); the error shows above it. */}
      {cell.spec !== null && (
        <Box marginTop={1} marginLeft={1} flexDirection="column">
          <Renderer spec={cell.spec} registry={inkRegistry} />
        </Box>
      )}
    </Box>
  );
}

/**
 * Strip stack-trace breadcrumbs from server errors so the inline footer
 * stays readable. Server returns "storage: Invalid user input: ..., /Users/.../merge_insert.rs:195:40"
 * — keep the human-readable prefix, drop the path.
 */
function condenseMutationError(raw: string): string {
  const match = raw.match(/^(omnigraph-server\s+\S+\s+returned\s+\d+:\s+)?(\{.*"error":"([^"]*)")/);
  if (match) {
    const inner = match[3]!;
    return inner.replace(/,\s+\/[^\s]+\.rs:\d+:\d+/, "").trim();
  }
  return raw.split("\n")[0]!.slice(0, 240);
}

function ApprovalsFooter({
  state,
}: {
  state: Record<string, unknown>;
}): React.ReactElement | null {
  const approvals =
    (state.approvals as Record<string, string> | undefined) ?? {};
  const entries = Object.entries(approvals);
  if (entries.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
      <Text dimColor>Approvals (in-memory)</Text>
      {entries.map(([id, statusVal]) => (
        <Text key={id}>
          <Text dimColor>{id}</Text> · {statusVal}
        </Text>
      ))}
    </Box>
  );
}
