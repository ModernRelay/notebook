import React from "react";
import { useActions, useStateValue } from "@json-render/react";
import type { ActionListRuntimeProps } from "@modernrelay/notebook-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ComponentCtx<P> {
  props: P;
}

type ActionDescriptor = ActionListRuntimeProps["actions"][number];

// Catalog variant vocabulary → COSS Button variants.
const BUTTON_VARIANT: Record<string, "default" | "destructive" | "outline"> = {
  default: "outline",
  primary: "default",
  danger: "destructive",
};

// Row status → COSS Badge variant.
const STATUS_VARIANT: Record<string, "success" | "error" | "secondary"> = {
  approved: "success",
  rejected: "error",
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
  cellId: string | undefined,
): void {
  if (act.mutation) {
    actions.execute({
      action: "mutate",
      params: { ...act.mutation, target_id: id, __cell_id: cellId },
    });
  } else if (act.action) {
    actions.execute({ action: act.action, params: { id } });
  }
}

export function ActionList({
  props: p,
}: ComponentCtx<ActionListRuntimeProps>): React.ReactElement {
  const actions = useActions();
  const statusMap =
    useStateValue<Record<string, string>>(p.status_state ?? "/__never__") ?? {};

  if (p.rows.length === 0) {
    return <p className="text-sm italic text-muted-foreground">(no items)</p>;
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
        const status =
          statusFromRow !== undefined && statusFromRow !== null
            ? String(statusFromRow)
            : id
              ? statusMap[id]
              : undefined;
        const mutationState = id ? p.runtime?.mutation_state?.[id] : undefined;
        const saving = mutationState?.saving === true;
        // The "active" action is whichever re-applies the current status — it
        // gets a subdued look so the OTHER action reads as the next click.
        const currentActionIdx = p.actions.findIndex(
          (a) => a.mutation && String(a.mutation.value) === status,
        );

        return (
          <li
            key={id || idx}
            className={cn(
              "flex items-start justify-between gap-4 rounded-lg border px-4 py-3 transition-colors",
              saving ? "border-info/40 bg-info/4" : "border-border bg-card",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-foreground">{title}</p>
                {status && (
                  <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>
                    {status}
                  </Badge>
                )}
                {saving && (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-info"
                    aria-live="polite"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
                    saving…
                  </span>
                )}
              </div>
              {body && (
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              )}
              {meta.length > 0 && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {meta.join(" · ")}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {p.actions.map((act, aIdx) => {
                const isCurrent = aIdx === currentActionIdx;
                return (
                  <Button
                    key={`${aIdx}-${act.action ?? "mutate"}`}
                    type="button"
                    size="sm"
                    variant={
                      isCurrent
                        ? "outline"
                        : (BUTTON_VARIANT[act.variant ?? "default"] ?? "outline")
                    }
                    disabled={saving}
                    aria-pressed={isCurrent}
                    onClick={() => fireAction(actions, act, id, p.runtime?.cell_id)}
                  >
                    {act.label}
                  </Button>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
