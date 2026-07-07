import type { SnapshotOutput } from "@modernrelay/notebook-client";

/**
 * Branch-staging helpers — pure functions behind the BranchBar. The review
 * summary is TABLE-level (per-table version + row-count deltas from two
 * `/snapshot` reads): the server's row-level diff engine has no HTTP
 * endpoint yet, and coarse-but-honest beats nothing before a merge.
 */
export interface TableDelta {
  /** e.g. "node:Task" — shown with the prefix stripped. */
  table: string;
  /** row_count(branch) − row_count(base); 0 = edits without net adds. */
  rowDelta: number;
  /** Base table version (undefined when the table is new on the branch). */
  fromVersion: number | undefined;
  toVersion: number;
  /**
   * True when the numbers alone would say "equal" but the table was last
   * written by a DIFFERENT lineage — versions are per-lineage counters, so
   * diverged branches can collide numerically while their contents differ.
   */
  diverged: boolean;
}

/**
 * Tables whose manifest state differs between the base and the branch,
 * name-sorted. Equal version + row count ⇒ untouched ⇒ elided; an empty
 * result means the branch has no staged changes (merge would be a no-op).
 */
export function computeTableDeltas(
  base: SnapshotOutput,
  branch: SnapshotOutput,
): TableDelta[] {
  const baseByKey = new Map(base.tables.map((t) => [t.table_key, t]));
  const deltas: TableDelta[] = [];
  for (const t of branch.tables) {
    const before = baseByKey.get(t.table_key);
    const numbersEqual =
      before !== undefined &&
      before.version === t.version &&
      before.row_count === t.row_count;
    const writersEqual = before !== undefined && before.writer === t.writer;
    if (numbersEqual && writersEqual) continue;
    deltas.push({
      table: t.table_key,
      rowDelta: t.row_count - (before?.row_count ?? 0),
      fromVersion: before?.version,
      toVersion: t.version,
      diverged: numbersEqual && !writersEqual,
    });
  }
  return deltas.sort((a, b) => a.table.localeCompare(b.table));
}

/** "node:Task" → "Task" (display form; non-prefixed keys pass through). */
export function tableDisplayName(tableKey: string): string {
  const idx = tableKey.indexOf(":");
  return idx === -1 ? tableKey : tableKey.slice(idx + 1);
}

/** "+3 rows" / "−1 row" / "±0" — the popover's delta chip text. */
export function rowDeltaLabel(delta: number): string {
  if (delta === 0) return "±0";
  const n = Math.abs(delta);
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${n} row${n === 1 ? "" : "s"}`;
}

/**
 * Default name for a new working branch: `work-<local YYYY-MM-DD>` (local
 * calendar date, same semantics as the `{$now: date}` marker).
 */
export function defaultBranchName(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `work-${d.getFullYear()}-${mm}-${dd}`;
}
