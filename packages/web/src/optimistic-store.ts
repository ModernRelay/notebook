// Reactive store for in-flight + recently-applied mutations.
//
// Why this exists: after a user clicks Approve/Reject, the canonical
// data path is one server round-trip (~100ms) + one re-fetch (~100ms)
// before the cell re-renders with the new status. That's perceptible.
// We instead patch the displayed row immediately ("optimistic UI"),
// fire the server mutation in the background, and reconcile when the
// fresh server data lands.
//
// Patches are keyed by (target_type, target_id, field) so they only
// override the specific column the user touched. ActionList reads the
// store via `useOptimisticPatch` and prefers the patch over the row's
// own field when present.
//
// Lifecycle:
//   click            → set({ value, savingSince: Date.now(), epoch })
//   server success   → markSaved(key)  (clears savingSince but keeps value)
//   server error     → clear(key)      (rolls back to row's own field)
//   fresh execution  → reconcile(epoch) (clears patches whose epoch
//                                        predates the execution; from
//                                        here the server's value is
//                                        authoritative)
//
// The store is a singleton because the mutate handler in App.tsx and
// the lens components live in unrelated React trees (the lens is
// dispatched through json-render's registry, which can't see App's
// `useState`).

export type OptimisticKey = `${string}:${string}:${string}`;

export interface Patch {
  target_type: string;
  target_id: string;
  field: string;
  /** The value the user requested. ActionList renders this. */
  value: unknown;
  /**
   * Timestamp at which the server mutation was kicked off. Cleared
   * (set to null) when the server returns success. Used to render the
   * "saving…" affordance.
   */
  savingSince: number | null;
  /**
   * `state.__mutation_epoch__` value at the moment the click fired.
   * Compared against the executor's most-recent run-completion epoch
   * so we can drop the patch once the server's fresh value has landed.
   */
  clickedAtEpoch: number;
}

export function keyOf(p: {
  target_type: string;
  target_id: string;
  field: string;
}): OptimisticKey {
  return `${p.target_type}:${p.target_id}:${p.field}`;
}

class OptimisticStore {
  private patches = new Map<OptimisticKey, Patch>();
  private listeners = new Set<() => void>();
  /** Bumped on every mutation so external subscribers see a fresh snapshot. */
  private version = 0;
  /** Cached snapshot reference for useSyncExternalStore's identity check. */
  private snapshot: ReadonlyMap<OptimisticKey, Patch> = new Map();

  set(patch: Omit<Patch, "savingSince" | "clickedAtEpoch"> & {
    clickedAtEpoch: number;
  }): void {
    const key = keyOf(patch);
    this.patches.set(key, { ...patch, savingSince: Date.now() });
    this.bump();
  }

  markSaved(key: OptimisticKey): void {
    const existing = this.patches.get(key);
    if (!existing) return;
    this.patches.set(key, { ...existing, savingSince: null });
    this.bump();
  }

  clear(key: OptimisticKey): void {
    if (!this.patches.has(key)) return;
    this.patches.delete(key);
    this.bump();
  }

  /**
   * Drop patches whose `clickedAtEpoch` is < `executionEpoch`. Called
   * after the executor finishes a run that was kicked off after the
   * patch — server data is now authoritative.
   */
  reconcile(executionEpoch: number): void {
    let changed = false;
    for (const [key, patch] of this.patches) {
      if (patch.clickedAtEpoch < executionEpoch) {
        this.patches.delete(key);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  get(key: OptimisticKey): Patch | undefined {
    return this.snapshot.get(key);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): ReadonlyMap<OptimisticKey, Patch> => this.snapshot;

  /** Server-side snapshot (used by React 19's SSR path; we don't SSR but the API requires it). */
  getServerSnapshot = (): ReadonlyMap<OptimisticKey, Patch> => this.snapshot;

  private bump(): void {
    this.version += 1;
    // Freeze a new snapshot so useSyncExternalStore detects the change
    // (Map identity, not Map contents).
    this.snapshot = new Map(this.patches);
    this.listeners.forEach((fn) => fn());
  }
}

export const optimisticStore = new OptimisticStore();
