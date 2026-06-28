import React, { useEffect, useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnnotationIntent } from "../annotations-store.js";
import type { PendingAnnotation } from "../annotation-context.js";
import { A } from "./annotation-style.js";

const INTENTS: AnnotationIntent[] = ["fix", "change", "question", "approve"];

/**
 * Anchored note popup — a faithful port of agentation's annotation popup
 * (#1a1a1a card, 16px radius, soft drop + 1px inner ring, single-line header,
 * rows=2 textarea, accent-focus, delete pinned left, pill actions). Centered
 * under the clicked entity. Parent keys this by entity id so state resets.
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
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const save = (): void => onSave(note.trim(), intent);

  // Centered under the entity (agentation anchors with translateX(-50%)).
  const center = pending.rect.left + pending.rect.width / 2;
  const left = Math.min(Math.max(center, 148), Math.max(148, window.innerWidth - 148));
  const top = Math.min(pending.rect.bottom + 8, Math.max(8, window.innerHeight - 280));

  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 100000 }} onClick={onClose} />
      <div
        role="dialog"
        aria-label="Annotate entity"
        className="fixed w-[280px] rounded-2xl px-4 pt-3 pb-3.5 text-white"
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
        {/* Single-line header — the entity (agentation's `.element`). */}
        <div className="mb-[0.5625rem] flex items-center gap-1.5 truncate text-xs">
          <span className="font-mono text-white/70">{pending.draft.key}</span>
          {pending.draft.headline && pending.draft.headline !== pending.draft.key && (
            <span className="truncate text-white/40">{pending.draft.headline}</span>
          )}
        </div>

        <textarea
          ref={ref}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Note for the agent…"
          rows={2}
          className="box-border w-full resize-none rounded-lg border bg-white/5 px-2.5 py-2 text-[0.8125rem] text-white outline-none placeholder:text-white/35"
          style={{ borderColor: focused ? A.accent : "rgba(255,255,255,0.15)" }}
        />

        {/* Intent (our addition, kept compact). */}
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
                style={on ? { background: A.accent } : undefined}
              >
                {it}
              </button>
            );
          })}
        </div>

        {/* Actions: delete pinned left (margin-right:auto), cancel + submit right. */}
        <div className="mt-2 flex items-center justify-end gap-1.5">
          {pending.existing && (
            <button
              type="button"
              aria-label="Delete annotation"
              title="Delete"
              onClick={() => onRemove(pending.existing!.id)}
              className="mr-auto flex size-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-[color:var(--ag-red-bg)] hover:text-[color:var(--ag-red)]"
              style={
                {
                  ["--ag-red" as string]: A.red,
                  ["--ag-red-bg" as string]: "color-mix(in srgb, " + A.red + " 25%, transparent)",
                } as React.CSSProperties
              }
            >
              <Trash2Icon className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl px-3.5 py-1.5 text-xs font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={note.trim() === "" && !pending.existing}
            className="rounded-2xl px-3.5 py-1.5 text-xs font-medium text-white transition-[filter] hover:brightness-90"
            style={{ background: A.accent, opacity: note.trim() || pending.existing ? 1 : 0.4 }}
          >
            {pending.existing ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </>
  );
}
