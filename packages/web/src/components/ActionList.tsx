import React, { useSyncExternalStore } from "react";
import { useActions, useStateValue } from "@json-render/react";
import type { ActionListRuntimeProps } from "@omnigraph/catalog";
import { keyOf, optimisticStore, type Patch } from "../optimistic-store.js";

interface ComponentCtx<P> {
  props: P;
}

type ActionDescriptor = ActionListRuntimeProps["actions"][number];

const VARIANTS: Record<string, string> = {
  default:
    "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700",
  primary:
    "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500",
  danger:
    "bg-red-700 hover:bg-red-600 text-white border-red-600",
};

const STATUS_BADGE: Record<string, string> = {
  approved: "bg-emerald-900/60 text-emerald-200 border-emerald-700",
  rejected: "bg-red-900/60 text-red-200 border-red-700",
};

/**
 * Dispatch one click. If the action descriptor carries a `mutation`, fire
 * the built-in `mutate` action with `{ ...mutation, target_id: id }`.
 * Otherwise fall back to the named state-only action.
 */
function fireAction(
  actions: ReturnType<typeof useActions>,
  act: ActionDescriptor,
  id: string,
): void {
  if (act.mutation) {
    actions.execute({
      action: "mutate",
      params: { ...act.mutation, target_id: id },
    });
  } else if (act.action) {
    actions.execute({ action: act.action, params: { id } });
  }
}

/**
 * For a given row, look up any optimistic patch that targets its
 * status field. Returns the patch if one is active, else undefined.
 * Reads `target_type` from the first action's mutation spec — all
 * actions on a single ActionList target the same node type by
 * construction (Approve and Reject both flip the same row).
 */
function lookupOptimisticPatch(
  patches: ReadonlyMap<string, Patch>,
  p: ActionListRuntimeProps,
  id: string,
): Patch | undefined {
  if (!p.status_field || !id) return undefined;
  const target_type = p.actions.find((a) => a.mutation)?.mutation?.target_type;
  if (!target_type) return undefined;
  return patches.get(keyOf({ target_type, target_id: id, field: p.status_field }));
}

export function ActionList({
  props: p,
}: ComponentCtx<ActionListRuntimeProps>): React.ReactElement {
  const actions = useActions();
  const statusMap =
    useStateValue<Record<string, string>>(p.status_state ?? "/__never__") ?? {};

  // Re-render whenever the optimistic store changes — applied patches
  // and in-flight "saving" indicators both live there.
  const patches = useSyncExternalStore(
    optimisticStore.subscribe,
    optimisticStore.getSnapshot,
    optimisticStore.getServerSnapshot,
  );

  if (p.rows.length === 0) {
    return <p className="italic text-zinc-500">(no items)</p>;
  }

  return (
    <ul className="space-y-3">
      {p.rows.map((row, idx) => {
        const id = String(row[p.id_column] ?? "");
        const title = String(row[p.title_column] ?? "");
        const body = p.body_column ? String(row[p.body_column] ?? "") : "";
        const meta =
          p.meta_columns?.map((c) => String(row[c] ?? "")).filter(Boolean) ??
          [];
        const statusFromRow = p.status_field
          ? row[p.status_field]
          : undefined;
        const baseStatus =
          statusFromRow !== undefined && statusFromRow !== null
            ? String(statusFromRow)
            : id
              ? statusMap[id]
              : undefined;
        const patch = lookupOptimisticPatch(patches, p, id);
        const status = patch ? String(patch.value) : baseStatus;
        const saving = patch?.savingSince != null;
        // The "active" action is whichever one would re-apply the
        // current status — its button gets a subdued look so the
        // OTHER action (the one that toggles to a new state) is the
        // visually obvious next click.
        const currentActionIdx = p.actions.findIndex(
          (a) => a.mutation && String(a.mutation.value) === status,
        );

        return (
          <li
            key={id || idx}
            className={
              "flex items-start justify-between gap-4 rounded-md border px-4 py-3 transition-colors " +
              (saving
                ? "border-cyan-800/60 bg-cyan-950/20"
                : "border-zinc-800 bg-zinc-900/40")
            }
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-zinc-100">{title}</p>
                {status && (
                  <span
                    className={
                      "rounded-full border px-2 py-0.5 text-xs font-medium " +
                      (STATUS_BADGE[status] ??
                        "bg-zinc-800 text-zinc-300 border-zinc-700")
                    }
                  >
                    {status}
                  </span>
                )}
                {saving && (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-cyan-400"
                    aria-live="polite"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                    saving…
                  </span>
                )}
              </div>
              {body && (
                <p className="mt-1 text-sm text-zinc-400">{body}</p>
              )}
              {meta.length > 0 && (
                <p className="mt-1 font-mono text-xs text-zinc-500">
                  {meta.join(" · ")}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {p.actions.map((act, aIdx) => {
                const isCurrent = aIdx === currentActionIdx;
                return (
                  <button
                    key={`${aIdx}-${act.action ?? "mutate"}`}
                    type="button"
                    disabled={saving}
                    onClick={() => fireAction(actions, act, id)}
                    aria-pressed={isCurrent}
                    className={
                      "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 " +
                      (isCurrent
                        ? "border-zinc-700 bg-zinc-800/40 text-zinc-400"
                        : (VARIANTS[act.variant ?? "default"] ?? VARIANTS.default))
                    }
                  >
                    {act.label}
                  </button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
