import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { JSONUIProvider, Renderer } from "@json-render/ink";
import type { MutationParams, Notebook } from "@omnigraph/notebook-spec";
import {
  getMutationSource,
  runNotebook,
  setAtPointer,
  type CellExecution,
  type NotebookExecution,
  type Source,
} from "@omnigraph/executor";
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
  | { kind: "done"; execution: NotebookExecution }
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
  const [status, setStatus] = useState<Status>({ kind: "running" });
  const [stateModel, setStateModel] = useState<Record<string, unknown>>({});
  const [activeCell, setActiveCell] = useState(0);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const { exit } = useApp();

  const cells = status.kind === "done" ? status.execution.cells : [];
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
      setStateModel((prev) => {
        let next = prev;
        for (const { path, value } of changes) {
          next = setAtPointer(next, path, value);
        }
        return next;
      });
    },
    [],
  );

  // useActions().execute() resolves handlers from JSONUIProvider.handlers,
  // not from defineRegistry.actions. Register the mutate path here so the
  // ActionList → execute({ action: "mutate", ... }) round-trip actually
  // dispatches.
  // Handlers MUST swallow mutation errors. json-render's executeAction
  // re-throws whatever the handler throws — and an unhandled async
  // rejection from useInput's keypress dispatch will crash the Node
  // process out of Ink's render. Catch here, render the message inline,
  // and keep the TUI alive.
  const handlers = useMemo(
    () => ({
      mutate: async (params: Record<string, unknown>) => {
        if (process.env.OMNIGRAPH_TUI_DEBUG) {
          process.stderr.write(
            `[debug] mutate handler entered: ${JSON.stringify(params)}\n`,
          );
        }
        try {
          await getMutationSource().mutate!(params as MutationParams);
          setMutationError(null);
          // Bump our state mirror to trigger executor re-run; the
          // refreshed read shows the new field value.
          setStateModel((prev) => ({
            ...prev,
            __mutation_epoch__: Date.now(),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setMutationError(condenseMutationError(message));
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    runNotebook(notebook, source, { state: stateModel })
      .then((execution) => {
        if (!cancelled) {
          setStatus({ kind: "done", execution });
          if (autoExit) setTimeout(() => exit(), 200);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus({ kind: "fatal", message });
          if (autoExit) setTimeout(() => exit(), 200);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notebook, source, stateModel, exit, autoExit]);

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

        {/* Tab strip: all cells, active highlighted */}
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

        {mutationError !== null && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red">mutation error</Text>
            <Text color="red" dimColor>
              {mutationError}
            </Text>
          </Box>
        )}

        <ApprovalsFooter state={stateModel} />

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
        {cell.error === null && cell.result !== null && (
          <Text dimColor>
            {" "}
            · {cell.result.row_count} row(s) · {cell.durationMs}ms
          </Text>
        )}
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
      {cell.error === null && cell.spec !== null && (
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
