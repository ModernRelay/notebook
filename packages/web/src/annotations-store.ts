import type { Notebook } from "@modernrelay/notebook-core";

/**
 * Browser-local annotation session — agentation's "click → note → copy" flow,
 * graph-native. The user flags graph entities (a Table row, a Subgraph node, …)
 * across a notebook and attaches a free-text note + optional intent; the
 * collection is copied to the clipboard as agent-ready markdown. Annotations are
 * ephemeral *feedback*, never written to the graph — so this is host-shell-only,
 * persisted per-notebook in `localStorage` (mirrors `layout-overrides.ts`). The
 * pure functions here stay testable apart from React and `localStorage`.
 */
export type AnnotationIntent = "fix" | "change" | "question" | "approve";

export interface Annotation {
  /** `${cellId}::${key}` — stable, so re-annotating an entity upserts. */
  id: string;
  cellId: string;
  lens: string;
  queryRef?: string;
  /** The entity's identity value (id/select column, or `#<rowIndex>` fallback). */
  key: string;
  headline: string;
  /** The entity's displayed columns — free context for the agent. */
  data: Record<string, unknown>;
  note: string;
  intent?: AnnotationIntent;
}

export interface AnnotationSession {
  items: Annotation[];
  /** A free-text instruction prepended to the export (what the agent should do). */
  instruction: string;
}

export const EMPTY_SESSION: AnnotationSession = { items: [], instruction: "" };
const KEY_PREFIX = "dashbook:annotations:v1:";

export function annotationId(cellId: string, key: string): string {
  return `${cellId}::${key}`;
}

/** djb2 → base36: a compact, stable fingerprint of the cell-id set. */
function hashIds(ids: string[]): string {
  const joined = [...ids].sort().join(" ");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Stable `localStorage` key for a notebook's annotation session. */
export function annotationsKey(notebook: Notebook): string {
  return `${KEY_PREFIX}${notebook.title}:${hashIds(notebook.cells.map((c) => c.id))}`;
}

export function loadAnnotations(key: string): AnnotationSession {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY_SESSION;
    const parsed = JSON.parse(raw) as Partial<AnnotationSession>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items.filter(isAnnotation) : [],
      instruction:
        typeof parsed.instruction === "string" ? parsed.instruction : "",
    };
  } catch {
    return EMPTY_SESSION; // unparseable / unavailable storage
  }
}

export function saveAnnotations(key: string, s: AnnotationSession): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* private mode / quota — best-effort */
  }
}

export function clearAnnotations(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isAnnotation(v: unknown): v is Annotation {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.cellId === "string" &&
    typeof o.key === "string" &&
    typeof o.note === "string"
  );
}

/**
 * Serialize a session to agent-ready markdown, grouped by cell (first-seen
 * order). Each item carries type+key, the source query, the displayed columns,
 * the intent tag, and the note — enough for an agent to act by slug.
 */
export function serializeAnnotations(
  notebook: Notebook,
  label: string,
  session: AnnotationSession,
): string {
  const lines: string[] = [
    `# Notebook annotations — ${notebook.title}`,
    `> ${label}`,
    "",
  ];
  const instruction = session.instruction.trim();
  if (instruction) {
    lines.push(instruction, "");
  }
  const byCell = new Map<string, Annotation[]>();
  for (const a of session.items) {
    const arr = byCell.get(a.cellId) ?? [];
    arr.push(a);
    byCell.set(a.cellId, arr);
  }
  for (const [cellId, items] of byCell) {
    const first = items[0]!;
    const q = first.queryRef ? ` · query: ${first.queryRef}` : "";
    lines.push(`## ${cellId} (${first.lens}${q})`);
    for (const a of items) {
      const tag = a.intent ? `[${a.intent}] ` : "";
      lines.push(`- ${tag}\`${a.key}\` — ${a.headline || a.key}`);
      const ctx = contextLine(a.data);
      if (ctx) lines.push(`  - ${ctx}`);
      if (a.note.trim()) lines.push(`  - note: ${a.note.trim()}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** A compact "col: val · col: val" context line; skips empties and long prose. */
function contextLine(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined || v === "") continue;
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (s.length > 80) continue;
    parts.push(`${k}: ${s}`);
    if (parts.length >= 6) break;
  }
  return parts.join(" · ");
}
