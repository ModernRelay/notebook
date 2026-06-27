import type { Notebook } from "../spec/index.js";
import { isControl } from "./controls.js";

/** Map each data cell to the set of `$state` JSON pointers its query reads. */
export function dependencyMap(notebook: Notebook): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const cell of notebook.cells) {
    if (isControl(cell) || !cell.query) continue;
    const deps = new Set<string>();
    if (cell.query.params !== undefined)
      collectStatePointers(cell.query.params, deps);
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
 * Every distinct `$state` query parameter a notebook reads, in first-seen order,
 * each with its first-seen `default`. These are the live "parameters" driving the
 * canvas — the values dependent cells re-resolve against. Host shells can surface
 * them (e.g. as copyable selection chips) so they're visible before any click.
 */
export function notebookStateParams(notebook: Notebook): StateParam[] {
  const seen = new Map<string, StateParam>();
  for (const cell of notebook.cells) {
    if (isControl(cell) || !cell.query?.params) continue;
    collectStateParams(cell.query.params, seen);
  }
  return [...seen.values()];
}

function collectStateParams(value: unknown, out: Map<string, StateParam>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStateParams(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.$state === "string" && !out.has(record.$state)) {
    out.set(record.$state, { pointer: record.$state, default: record.default });
  }
  for (const item of Object.values(record)) collectStateParams(item, out);
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

function resolveExpr(value: unknown, state: Record<string, unknown>): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "$state" in value
  ) {
    const obj = value as { $state: unknown; default?: unknown };
    if (typeof obj.$state !== "string") return undefined;
    const resolved = resolveStatePointer(state, obj.$state);
    if (resolved === undefined || resolved === null || resolved === "") {
      return obj.default;
    }
    return resolved;
  }
  return value;
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
