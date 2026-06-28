import React, { useEffect, useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnnotationIntent } from "../annotations-store.js";
import type { PendingAnnotation } from "../annotation-context.js";
import { A } from "./annotation-style.js";

const INTENTS: AnnotationIntent[] = ["fix", "change", "question", "approve"];

/**
 * Anchored note popup, styled as agentation's dark floating card (#1a1a1a,
 * 16px radius, soft drop + 1px inner ring). Centered under the clicked entity.
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

  // Centered under the entity (agentation anchors with translateX(-50%)).
  const center = pending.rect.left + pending.rect.width / 2;
  const left = Math.min(Math.max(center, 148), Math.max(148, window.innerWidth - 148));
  const top = Math.min(pending.rect.bottom + 8, Math.max(8, window.innerHeight - 260));

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: 100000 }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Annotate entity"
        className="fixed w-[280px] rounded-2xl px-4 pb-3.5 pt-3 text-white"
        style={{
          top,
          left,
          transform: "translateX(-50%)",
          background: A.surface,
          boxShadow: A.shadow,
          fontFamily: A.font,
          zIndex: 100001,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 min-w-0">
          <div className="truncate text-xs text-white/50">
            {pending.lens} · <span className="font-mono">{pending.draft.key}</span>
          </div>
          <div className="truncate text-[0.8125rem] font-medium">
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
          className="w-full resize-none rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 text-[0.8125rem] text-white outline-none placeholder:text-white/30 focus:border-[color:var(--ag-accent)]"
          style={{ ["--ag-accent" as string]: A.blue }}
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {INTENTS.map((it) => {
            const on = intent === it;
            return (
              <button
                key={it}
                type="button"
                onClick={() => setIntent((cur) => (cur === it ? undefined : it))}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[0.6875rem] capitalize transition-colors",
                  on
                    ? "border-transparent text-white"
                    : "border-white/15 text-white/50 hover:text-white/80",
                )}
                style={on ? { background: A.blue } : undefined}
              >
                {it}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div>
            {pending.existing && (
              <button
                type="button"
                aria-label="Delete annotation"
                title="Delete"
                onClick={() => onRemove(pending.existing!.id)}
                className="flex size-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2.5 py-1 text-xs text-white/50 transition-colors hover:text-white/80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={note.trim() === "" && !pending.existing}
              className="rounded-lg px-3 py-1 text-xs font-medium text-white transition-[filter] hover:brightness-90 disabled:opacity-40"
              style={{ background: A.blue }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
