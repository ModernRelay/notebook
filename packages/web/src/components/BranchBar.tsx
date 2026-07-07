import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  OmnigraphHttpError,
  type Client,
  type MergeConflictInfo,
} from "@modernrelay/notebook-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useToastManager } from "@/components/ui/toast";
import {
  computeTableDeltas,
  defaultBranchName,
  rowDeltaLabel,
  tableDisplayName,
  type TableDelta,
} from "../branch.js";

export interface BranchBarProps {
  client: Client;
  /** The session's active branch (concrete — "main" when on the default). */
  current: string;
  /** The branch the session boots on; merges default back to it. */
  baseBranch: string;
  onSwitch: (branch: string) => void;
}

type ReviewState =
  | { phase: "loading" }
  | { phase: "ready"; deltas: TableDelta[] }
  | { phase: "merged"; outcome: string }
  | { phase: "conflicts"; conflicts: MergeConflictInfo[] }
  | { phase: "error"; message: string };

/**
 * Session branch staging in the app chrome: switch/create branches (the whole
 * canvas re-targets — reads AND writes follow), review a table-level change
 * summary against the base, then merge back or delete to abandon. Merge is
 * all-or-nothing server-side; conflicts render structured and leave the base
 * untouched.
 */
export function BranchBar({
  client,
  current,
  baseBranch,
  onSwitch,
}: BranchBarProps): React.ReactElement {
  const toast = useToastManager();
  const [branches, setBranches] = useState<string[]>([current]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(defaultBranchName);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  // Two-step confirms (merge / delete), auto-disarmed like mutation buttons.
  const [armed, setArmed] = useState<"merge" | "delete" | null>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback((kind: "merge" | "delete") => {
    setArmed(kind);
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    disarmTimer.current = setTimeout(() => setArmed(null), 4000);
  }, []);

  const refreshBranches = useCallback(async () => {
    try {
      const r = await client.branches();
      // main (or the boot base) first, then alphabetical.
      const sorted = [...r.branches].sort((a, b) =>
        a === baseBranch ? -1 : b === baseBranch ? 1 : a.localeCompare(b),
      );
      setBranches(sorted);
    } catch {
      /* chrome affordance — a failed list keeps the current entry only */
    }
  }, [client, baseBranch]);

  useEffect(() => {
    void refreshBranches();
  }, [refreshBranches]);

  const openReview = useCallback(async () => {
    setReview({ phase: "loading" });
    setArmed(null);
    try {
      const [base, branch] = await Promise.all([
        client.snapshot(baseBranch),
        client.snapshot(current),
      ]);
      setReview({ phase: "ready", deltas: computeTableDeltas(base, branch) });
    } catch (err) {
      setReview({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [client, baseBranch, current]);

  const createBranch = useCallback(async () => {
    const name = newName.trim();
    if (name === "") return;
    setBusy(true);
    try {
      await client.createBranch(name, current);
      toast.add({ title: `Branch ${name} created from ${current}` });
      setCreating(false);
      setMenuOpen(false);
      void refreshBranches();
      onSwitch(name);
    } catch (err) {
      if (err instanceof OmnigraphHttpError && err.status === 409) {
        // Name already exists — switching to it is what the user meant.
        toast.add({ title: `Branch ${name} already exists — switched to it` });
        setCreating(false);
        setMenuOpen(false);
        onSwitch(name);
      } else {
        toast.add({
          title: `Branch create failed: ${err instanceof Error ? err.message : String(err)}`,
          tone: "error",
        });
      }
    } finally {
      setBusy(false);
    }
  }, [client, newName, current, onSwitch, refreshBranches, toast]);

  const merge = useCallback(async () => {
    setBusy(true);
    setArmed(null);
    try {
      const result = await client.mergeBranch(current, baseBranch);
      if (result.ok) {
        toast.add({ title: `Merged ${current} into ${baseBranch} (${result.outcome.replace(/_/g, " ")})` });
        setReview({ phase: "merged", outcome: result.outcome });
      } else {
        setReview({ phase: "conflicts", conflicts: result.conflicts });
      }
    } catch (err) {
      toast.add({
        title: `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [client, current, baseBranch, toast]);

  const deleteBranch = useCallback(async () => {
    setBusy(true);
    setArmed(null);
    try {
      await client.deleteBranch(current);
      toast.add({ title: `Branch ${current} deleted` });
      setReview(null);
      void refreshBranches();
      onSwitch(baseBranch);
    } catch (err) {
      toast.add({
        title: `Branch delete failed: ${err instanceof Error ? err.message : String(err)}`,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [client, current, baseBranch, onSwitch, refreshBranches, toast]);

  const onBranch = current !== baseBranch;

  return (
    <div className="relative flex items-center gap-1.5">
      {/* Branch picker */}
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setMenuOpen((o) => {
              // Refresh on open so branches created elsewhere (another tab,
              // an agent, curl) appear without a page reload.
              if (!o) void refreshBranches();
              return !o;
            });
            setCreating(false);
          }}
          aria-expanded={menuOpen}
          title="Switch or create a working branch"
          className={onBranch ? "border-primary text-foreground" : "text-muted-foreground"}
        >
          <span aria-hidden>⎇</span>
          {current}
        </Button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
              <ul className="max-h-64 overflow-y-auto">
                {branches.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent ${name === current ? "font-semibold" : ""}`}
                      onClick={() => {
                        setMenuOpen(false);
                        if (name !== current) onSwitch(name);
                      }}
                    >
                      {name}
                      {name === current && <span aria-hidden>✓</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-1 border-t border-border pt-1">
                {creating ? (
                  <form
                    className="flex items-center gap-1 p-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void createBranch();
                    }}
                  >
                    <Input
                      size="sm"
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      aria-label="New branch name"
                    />
                    <Button type="submit" size="sm" disabled={busy || newName.trim() === ""}>
                      {busy ? <Spinner /> : "Create"}
                    </Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                    onClick={() => {
                      setNewName(defaultBranchName());
                      setCreating(true);
                    }}
                  >
                    + New branch from {current}…
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Review & merge — only on a working branch */}
      {onBranch && (
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (review === null) void openReview();
              else setReview(null);
            }}
            aria-expanded={review !== null}
          >
            Review & merge
          </Button>
          {review !== null && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setReview(null)} />
              <div className="absolute right-0 z-50 mt-1 w-96 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {current} → {baseBranch}
                </p>
                {review.phase === "loading" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner /> comparing snapshots…
                  </p>
                )}
                {review.phase === "error" && (
                  <p className="text-sm text-destructive">{review.message}</p>
                )}
                {review.phase === "ready" && (
                  <>
                    {review.deltas.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No changes yet — the branch matches {baseBranch}.
                      </p>
                    ) : (
                      <ul className="mb-2 space-y-1" data-testid="delta-list">
                        {review.deltas.map((d) => (
                          <li key={d.table} className="flex items-center justify-between text-sm">
                            <span className="font-mono">{tableDisplayName(d.table)}</span>
                            <span className="flex items-center gap-2">
                              <Badge variant="outline">
                                {d.removed
                                  ? "removed"
                                  : d.diverged
                                    ? "diverged"
                                    : rowDeltaLabel(d.rowDelta)}
                              </Badge>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {d.diverged
                                  ? `both at v${d.toVersion}`
                                  : `${d.fromVersion !== undefined ? `v${d.fromVersion} → ` : "new · "}v${d.toVersion}`}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => (armed === "delete" ? void deleteBranch() : arm("delete"))}
                      >
                        {armed === "delete" ? "Really delete?" : "Delete branch"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy || review.deltas.length === 0}
                        onClick={() => (armed === "merge" ? void merge() : arm("merge"))}
                      >
                        {busy ? <Spinner /> : armed === "merge" ? `Confirm merge into ${baseBranch}` : `Merge into ${baseBranch}`}
                      </Button>
                    </div>
                  </>
                )}
                {review.phase === "merged" && (
                  <>
                    <p className="text-sm">
                      Merged ({review.outcome.replace(/_/g, " ")}). The branch still
                      exists — delete it?
                    </p>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReview(null);
                          onSwitch(baseBranch);
                        }}
                      >
                        Keep it
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => void deleteBranch()}
                      >
                        Delete {current}
                      </Button>
                    </div>
                  </>
                )}
                {review.phase === "conflicts" && (
                  <>
                    <p className="mb-1 text-sm font-medium text-destructive">
                      Merge blocked — {review.conflicts.length} conflict
                      {review.conflicts.length === 1 ? "" : "s"} ({baseBranch} is untouched):
                    </p>
                    <ul className="max-h-48 space-y-1 overflow-y-auto" data-testid="conflict-list">
                      {review.conflicts.map((c, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-mono">{tableDisplayName(c.table_key)}</span>
                          {c.row_id !== undefined && (
                            <span className="font-mono text-muted-foreground"> /{c.row_id}</span>
                          )}
                          {" — "}
                          <Badge variant="outline">{c.kind}</Badge> {c.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
