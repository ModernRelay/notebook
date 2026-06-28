import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AnnotationIntent } from "../annotations-store.js";
import type { PendingAnnotation } from "../annotation-context.js";

const INTENTS: AnnotationIntent[] = ["fix", "change", "question", "approve"];

/**
 * Anchored note popup — opened when an entity is clicked in annotate mode.
 * Positioned from the clicked element's rect (agentation's popup, entity-anchored).
 * The parent keys this by entity id, so state resets between targets.
 */
export function AnnotationPopup({
  pending,
  onSave,
  onRemove,
  onClose,
}: {
  pending: PendingAnnotation;
  onSave: (note: string, intent?: AnnotationIntent) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [note, setNote] = useState(pending.existing?.note ?? "");
  const [intent, setIntent] = useState<AnnotationIntent | undefined>(
    pending.existing?.intent,
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const save = (): void => onSave(note.trim(), intent);

  // Clamp into the viewport (popup ~ 320×240).
  const left = Math.min(
    Math.max(pending.rect.left, 8),
    Math.max(8, window.innerWidth - 340),
  );
  const top = Math.min(
    pending.rect.bottom + 6,
    Math.max(8, window.innerHeight - 260),
  );

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Annotate entity"
        className="fixed z-50 w-80 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 min-w-0">
          <div className="truncate text-xs text-muted-foreground">
            {pending.lens} · <span className="font-mono">{pending.draft.key}</span>
          </div>
          <div className="truncate text-sm font-medium">
            {pending.draft.headline || pending.draft.key}
          </div>
        </div>
        <textarea
          ref={ref}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Note for the agent…"
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {INTENTS.map((it) => (
            <button
              key={it}
              type="button"
              onClick={() => setIntent((cur) => (cur === it ? undefined : it))}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs capitalize transition-colors",
                intent === it
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {it}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div>
            {pending.existing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => onRemove(pending.existing!.id)}
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={note.trim() === "" && !pending.existing}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
