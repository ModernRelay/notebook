import React, { useEffect, useRef, useState } from "react";
import { useActions, useStateStore } from "@json-render/react";
import {
  readStatePointer,
  type ButtonRuntimeProps,
} from "@modernrelay/notebook-core";
import { Button as CossButton } from "@/components/ui/button";

interface ComponentCtx<P> {
  props: P;
  emit: (event: string) => void;
}

// Catalog variant vocabulary → COSS Button variants.
const VARIANT: Record<
  NonNullable<ButtonRuntimeProps["variant"]>,
  "default" | "destructive" | "outline"
> = {
  default: "outline",
  primary: "default",
  danger: "destructive",
};

/**
 * Submit guard: true once every required state pointer resolves to a non-empty
 * value. Reads the whole state once (a single `useStateStore` subscription, so
 * the hook count is fixed regardless of how many pointers `requires` lists),
 * then resolves each pointer purely with the same reader the runtime uses — so
 * "is it set here" matches "what the mutation will send".
 */
function useAllSet(pointers: string[]): boolean {
  const { state } = useStateStore();
  return pointers.every((ptr) => {
    const v = readStatePointer(state as Record<string, unknown>, ptr);
    return v !== undefined && v !== null && v !== "";
  });
}

export function Button({
  props: p,
  emit,
}: ComponentCtx<ButtonRuntimeProps>): React.ReactElement {
  const actions = useActions();
  const saving = p.runtime?.saving === true;
  const ready = useAllSet(p.requires ?? []);
  // A mutation button is disabled while saving or until its inputs are set.
  const disabled = Boolean(p.mutation) && (saving || !ready);
  // Inline destructive guard (mutation.confirm): first click arms, second
  // fires; auto-disarms after 4s so an armed button can't linger.
  const confirm = p.mutation?.confirm;
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = (): void => {
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    disarmTimer.current = null;
    setArmed(false);
  };
  useEffect(
    () => () => {
      if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    },
    [],
  );

  const fire = (): void => {
    if (p.mutation) {
      // Non-row write. json-render has already resolved any { $state } in
      // p.mutation.params to current values (props resolve at render); the
      // runtime resolves any surviving markers, dispatches, and owns the
      // in-flight saving flag keyed by cell id.
      actions.execute({
        action: "mutate",
        params: { spec: p.mutation, __cell_id: p.runtime?.cell_id },
      });
    } else {
      emit("press");
    }
  };
  const onClick = (): void => {
    if (confirm !== undefined && !armed) {
      if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
      disarmTimer.current = setTimeout(() => setArmed(false), 4000);
      setArmed(true);
      return;
    }
    disarm();
    fire();
  };
  const label = armed
    ? typeof confirm === "string"
      ? confirm
      : "Confirm?"
    : p.label;

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <CossButton
          type="button"
          variant={VARIANT[p.variant ?? "default"]}
          size="sm"
          disabled={disabled}
          aria-live={confirm !== undefined ? "polite" : undefined}
          onClick={onClick}
        >
          {saving ? "Saving…" : label}
        </CossButton>
        {armed && (
          <CossButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="cancel"
            onClick={disarm}
          >
            ✕
          </CossButton>
        )}
      </div>
      {p.runtime?.error !== undefined && !saving && (
        <p className="text-xs text-warning" role="alert">
          ⚠ {p.runtime.error}
        </p>
      )}
    </div>
  );
}
