import type { Notebook } from "../spec/index.js";
import { isControl } from "./controls.js";
import { formPickerQueries } from "./pickers.js";

/** Map each data cell to the set of `$state` JSON pointers its query reads. */
export function dependencyMap(notebook: Notebook): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const cell of notebook.cells) {
    if (isControl(cell)) continue;
    const pickers = formPickerQueries(cell);
    if (!cell.query && pickers.length === 0) continue;
    const deps = new Set<string>();
    if (cell.query?.params !== undefined)
      collectStatePointers(cell.query.params, deps);
    for (const picker of pickers) {
      if (picker.query.params !== undefined)
        collectStatePointers(picker.query.params, deps);
    }
    out.set(cell.id, deps);
  }
  return out;
}

function collectStatePointers(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStatePointers(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.$state === "string") out.add(record.$state);
  for (const item of Object.values(record)) collectStatePointers(item, out);
}

export function pointersOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** A query parameter bound to state: its JSON pointer + optional literal default. */
export interface StateParam {
  pointer: string;
  default?: unknown;
}

/**
 * Every distinct `$state` query parameter a notebook reads, in first-seen order.
 * A `default` is surfaced only when *every* binding of the pointer agrees on it
 * (a cell that declares no default counts as a distinct value); otherwise the
 * default is undefined, so a host chip never shows a value some readers don't
 * use. These are the live "parameters" driving the canvas — the values dependent
 * cells re-resolve against. Host shells can surface them (e.g. as copyable
 * selection chips) so they're visible before any click.
 */
/** Sentinel for "this binding declares no default" — a distinct per-cell value
 *  (that cell resolves to undefined), so a surfaced default requires *every*
 *  binding of the pointer to agree, not just the ones that declare one. */
const NO_DEFAULT = Symbol("no-default");

export function notebookStateParams(notebook: Notebook): StateParam[] {
  const order: string[] = []; // pointers in first-seen order
  const defaults = new Map<string, { value: unknown; consistent: boolean }>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.$state === "string") {
      const ptr = record.$state;
      const d = "default" in record ? record.default : NO_DEFAULT;
      const existing = defaults.get(ptr);
      if (!existing) {
        order.push(ptr);
        defaults.set(ptr, { value: d, consistent: true });
      } else if (existing.consistent && existing.value !== d) {
        existing.consistent = false; // bindings disagree → no single default
      }
    }
    for (const item of Object.values(record)) visit(item);
  };

  for (const cell of notebook.cells) {
    if (isControl(cell)) continue;
    if (cell.query?.params !== undefined) visit(cell.query.params);
    for (const picker of formPickerQueries(cell)) {
      if (picker.query.params !== undefined) visit(picker.query.params);
    }
  }

  return order.map((pointer) => {
    const e = defaults.get(pointer);
    const value =
      e && e.consistent && e.value !== NO_DEFAULT ? e.value : undefined;
    return { pointer, default: value };
  });
}

/** Read the value at a JSON pointer in a state object (undefined if absent). */
export function readStatePointer(
  state: Record<string, unknown>,
  pointer: string,
): unknown {
  return resolveStatePointer(state, pointer);
}

export function resolveParams(
  params: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = resolveExpr(value, state);
  }
  return out;
}

/**
 * Resolve a mutation's `params` map for dispatch. Each value is a literal, a
 * clicked-row column ref `{ $row: "<col>" }`, a Form submitted-value ref
 * `{ $input: "<field>" }`, or a state ref `{ $state }`, possibly nested
 * inside arrays/objects. `$row` resolves from the clicked row (a row lens
 * supplies it), `$input` from the submitted field-value map (a Form batch
 * supplies it), `$state` from notebook state. The source never sees a marker.
 */
export function resolveMutationParams(
  params: Record<string, unknown> | undefined,
  row: Record<string, unknown> | undefined,
  state: Record<string, unknown>,
  input?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params)) {
    out[key] = resolveExpr(value, state, row, input);
  }
  return out;
}

/**
 * Recursively resolve `{ $state: "/ptr", default? }` and — when the matching
 * bag is given — `{ $row: "<col>" }` / `{ $input: "<field>" }` markers
 * wherever they appear in a value: arrays and nested objects included. Marker
 * objects are leaves; plain objects/arrays are walked. This mirrors the
 * validator's recursive marker detection (`containsStateExpr` in
 * cli/validate), so a value the validator treats as dynamic is exactly the
 * value the runtime resolves — there is no "marked dynamic but sent literal"
 * gap.
 */
function resolveExpr(
  value: unknown,
  state: Record<string, unknown>,
  row?: Record<string, unknown>,
  input?: Record<string, unknown>,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => resolveExpr(item, state, row, input));
  }
  if (row !== undefined && "$row" in value) {
    const col = (value as { $row: unknown }).$row;
    return typeof col === "string" ? row[col] : undefined;
  }
  if (input !== undefined && "$input" in value) {
    const field = (value as { $input: unknown }).$input;
    return typeof field === "string" ? input[field] : undefined;
  }
  if ("$now" in value) {
    // Dispatch-time timestamp: { $now: date } → "YYYY-MM-DD",
    // { $now: datetime } → full ISO 8601. Optional `offset_days` shifts the
    // instant (e.g. -60 → sixty days ago) for threshold params like
    // "updated before". Never goes stale in the YAML.
    const marker = value as { $now: unknown; offset_days?: unknown };
    const offsetDays =
      typeof marker.offset_days === "number" ? marker.offset_days : 0;
    const iso = new Date(
      Date.now() + offsetDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    return marker.$now === "datetime" ? iso : iso.slice(0, 10);
  }
  if ("$state" in value) {
    const obj = value as { $state: unknown; default?: unknown };
    if (typeof obj.$state !== "string") return undefined;
    const resolved = resolveStatePointer(state, obj.$state);
    if (resolved === undefined || resolved === null || resolved === "") {
      return obj.default;
    }
    return resolved;
  }
  // Plain object → recurse over its values (resolve any nested markers).
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = resolveExpr(v, state, row, input);
  }
  return out;
}

function resolveStatePointer(
  state: Record<string, unknown>,
  pointer: string,
): unknown {
  if (!pointer.startsWith("/")) return undefined;
  const parts = pointer
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = state;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setAtPointer(
  state: Record<string, unknown>,
  pointer: string,
  value: unknown,
): Record<string, unknown> {
  if (!pointer.startsWith("/")) return state;
  const parts = pointer
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.length === 0) return state;

  const root: Record<string, unknown> = { ...state };
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] as string;
    const existing = cur[key];
    const next: Record<string, unknown> =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cur[key] = next;
    cur = next;
  }
  cur[parts[parts.length - 1] as string] = value;
  return root;
}
