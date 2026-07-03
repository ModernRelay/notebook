import React, { useEffect, useRef, useState } from "react";
import { useActions, useStateValue } from "@json-render/react";
import type { ActionListRuntimeProps } from "@modernrelay/notebook-core";
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
 * Dispatch one click. If the action descriptor carries a `mutation`, fire the
 * built-in `mutate` action with `{ spec: mutation, row, rowKey: id }` — the
 * runtime resolves `$row`/`$state` params and invokes the source. Otherwise
 * fall back to the named state-only action.
 */
function fireAction(
  actions: ReturnType<typeof useActions>,
  act: ActionDescriptor,
  row: Record<string, unknown>,
  id: string,
  cellId: string | undefined,
): void {
  if (act.mutation) {
    actions.execute({
      action: "mutate",
      params: { spec: act.mutation, row, rowKey: id, __cell_id: cellId },
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
  // Inline destructive guard: which action button is armed (`rowId:actionIdx`).
  // A first click arms; only a second click within the window fires. The
  // timer auto-disarms so a stray click can't linger as a loaded gun.
  const [armed, setArmed] = useState<string | null>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = (): void => {
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    disarmTimer.current = null;
    setArmed(null);
  };
  const arm = (key: string): void => {
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    disarmTimer.current = setTimeout(() => setArmed(null), 4000);
    setArmed(key);
  };
  useEffect(
    () => () => {
      if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    },
    [],
  );

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
        // The "active" action re-applies the current status — detect it from the
        // action's optimistic overlay of the status_field (the old set_field
        // `value` is gone).
        const currentActionIdx = p.actions.findIndex((a) => {
          const f = p.status_field;
          if (f === undefined) return false;
          const overlay = a.mutation?.optimistic?.set?.[f];
          return overlay !== undefined && String(overlay) === status;
        });

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
              {mutationState?.error !== undefined && !saving && (
                <p className="mt-1 text-xs text-warning" role="alert">
                  ⚠ {mutationState.error}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {p.actions.map((act, aIdx) => {
                const isCurrent = aIdx === currentActionIdx;
                const confirm = act.mutation?.confirm;
                const armKey = `${id}:${aIdx}`;
                const isArmed = armed === armKey;
                const label = isArmed
                  ? typeof confirm === "string"
                    ? confirm
                    : "Confirm?"
                  : act.label;
                const fire = (): void => {
                  disarm();
                  fireAction(actions, act, row, id, p.runtime?.cell_id);
                };
                return (
                  <React.Fragment key={`${aIdx}-${act.action ?? "mutate"}`}>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        isCurrent
                          ? "outline"
                          : (BUTTON_VARIANT[act.variant ?? "default"] ??
                            "outline")
                      }
                      disabled={saving}
                      aria-pressed={isCurrent}
                      aria-live={confirm !== undefined ? "polite" : undefined}
                      onClick={() => {
                        if (confirm !== undefined && !isArmed) arm(armKey);
                        else fire();
                      }}
                    >
                      {label}
                    </Button>
                    {isArmed && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label="cancel"
                        onClick={disarm}
                      >
                        ✕
                      </Button>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
