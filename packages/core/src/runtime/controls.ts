import type { VisibilityCondition } from "@json-render/core";
import type { Cell, ControlKind, Notebook } from "../spec/index.js";
import { assembleControlSpec, type LensSpec } from "../catalog/index.js";
import type { CellExecution } from "./types.js";

const CONTROL_KINDS: readonly ControlKind[] = [
  "Button",
  "Toggle",
  "Select",
  "TextInput",
  "NumberInput",
];

export function isControl(cell: Cell): boolean {
  if (!(CONTROL_KINDS as readonly string[]).includes(cell.lens)) return false;
  // A query-backed Select is a data cell: it reads, registers $state deps,
  // and participates in invalidation. A query-less Select stays a control.
  if (cell.lens === "Select" && cell.query !== undefined) return false;
  return true;
}

export function dataCellIds(notebook: Notebook): string[] {
  return notebook.cells
    .filter((cell) => !isControl(cell))
    .map((cell) => cell.id);
}

export function emptyCellExecution(cell: Cell): CellExecution {
  return {
    cell,
    result: null,
    spec: null,
    controlSpecs: buildControlSpecs(cell),
    durationMs: 0,
    error: null,
    pending: false,
  };
}

export function buildControlCellExecution(
  cell: Cell,
  durationMs: number,
  runtimeProps?: Record<string, unknown>,
): CellExecution {
  const spec = assembleControlSpec(cell.id, cell.lens, cell.props, {
    on: cell.on,
    visible: cell.visible as VisibilityCondition | undefined,
    ...(runtimeProps !== undefined ? { runtimeProps } : {}),
  });
  return {
    cell,
    result: null,
    spec,
    controlSpecs: buildControlSpecs(cell),
    durationMs,
    error: null,
    pending: false,
  };
}

export function buildControlSpecs(cell: Cell): LensSpec[] {
  if (!cell.controls || cell.controls.length === 0) return [];
  return cell.controls.map((ctl, idx) => {
    const ctlId = ctl.id ?? `${cell.id}__ctl_${idx}`;
    return assembleControlSpec(ctlId, ctl.lens, ctl.props, {
      on: ctl.on,
      visible: ctl.visible as VisibilityCondition | undefined,
    });
  });
}
