import React, { useState } from "react";
import {
  CheckIcon,
  ClipboardIcon,
  ListIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Annotation, AnnotationSession } from "../annotations-store.js";
import { A } from "./annotation-style.js";

/**
 * Floating bottom-right control — a faithful port of agentation's toolbar:
 * a collapsed 44px circle (annotate toggle) that expands to a pill of 34px
 * circular control buttons with a count badge. An optional list panel opens
 * above it (its "settings panel" position).
 */
export function AnnotationToolbar({
  active,
  onToggleActive,
  session,
  onInstruction,
  onRemove,
  onClear,
  onCopy,
}: {
  active: boolean;
  onToggleActive: (next: boolean) => void;
  session: AnnotationSession;
  onInstruction: (s: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCopy: () => Promise<boolean>;
}): React.ReactElement {
  const count = session.items.length;
  const expanded = active || count > 0;
  const [showList, setShowList] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void onCopy().then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  // Collapsed FAB: a 44px circle that turns annotate mode on.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => onToggleActive(true)}
        title="Annotate"
        aria-label="Annotate"
        className="fixed bottom-5 right-5 flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-[#2a2a2a] active:scale-95"
        style={{ background: A.surface, boxShadow: A.barShadow, zIndex: 100000, fontFamily: A.font }}
      >
        <PencilIcon className="size-5" />
      </button>
    );
  }

  // Numbered list grouped by cell (1-based global order).
  const numberById = new Map<string, number>();
  session.items.forEach((a, i) => numberById.set(a.id, i + 1));
  const groups: Array<[string, Annotation[]]> = [];
  const byCell = new Map<string, Annotation[]>();
  for (const a of session.items) {
    let arr = byCell.get(a.cellId);
    if (!arr) {
      arr = [];
      byCell.set(a.cellId, arr);
      groups.push([a.cellId, arr]);
    }
    arr.push(a);
  }

  return (
    <div className="fixed bottom-5 right-5 flex flex-col items-end" style={{ zIndex: 100000, fontFamily: A.font }}>
      {showList && (
        <div
          className="mb-2 max-h-[60vh] w-80 max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-2xl p-3 text-white"
          style={{ background: A.surface, boxShadow: A.shadow }}
        >
          <textarea
            value={session.instruction}
            onChange={(e) => onInstruction(e.target.value)}
            placeholder="Overall instruction for the agent (optional)…"
            rows={2}
            className="mb-3 box-border w-full resize-none rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 text-[0.8125rem] text-white outline-none placeholder:text-white/35 focus:border-[color:var(--ag-accent)]"
            style={{ ["--ag-accent" as string]: A.accent }}
          />
          {count === 0 ? (
            <p className="py-4 text-center text-xs text-white/40">
              Click an entity to annotate it.
            </p>
          ) : (
            <ul className="space-y-3">
              {groups.map(([cellId, items]) => (
                <li key={cellId}>
                  <div className="mb-1 text-xs font-medium text-white/45">{cellId}</div>
                  <ul className="space-y-1">
                    {items.map((a) => (
                      <li
                        key={a.id}
                        className="group flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5"
                      >
                        <span
                          className="mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold text-white"
                          style={{ background: A.blue }}
                        >
                          {numberById.get(a.id)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {a.intent && (
                              <span className="rounded-full border border-white/15 px-1.5 text-[10px] capitalize text-white/55">
                                {a.intent}
                              </span>
                            )}
                            <span className="truncate font-mono text-xs text-white/80">{a.key}</span>
                          </div>
                          {a.note && <p className="mt-0.5 text-xs text-white/85">{a.note}</p>}
                        </div>
                        <button
                          type="button"
                          aria-label="Remove annotation"
                          onClick={() => onRemove(a.id)}
                          className="text-white/40 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        className="relative flex h-11 items-center gap-1.5 rounded-3xl px-1.5 text-white"
        style={{ background: A.surface, boxShadow: A.barShadow }}
      >
        {count > 0 && (
          <span
            className="absolute -right-[13px] -top-[13px] flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-[5px] text-[0.625rem] font-semibold text-white"
            style={{
              background: A.accent,
              boxShadow: "0 1px 3px rgba(0,0,0,0.15), inset 0 0 0 1px rgba(255,255,255,0.04)",
            }}
          >
            {count}
          </span>
        )}
        <ControlButton active={active} onClick={() => onToggleActive(!active)} title="Annotate">
          <PencilIcon className="size-[18px]" />
        </ControlButton>
        <ControlButton onClick={copy} disabled={count === 0} title="Copy for agent">
          {copied ? (
            <CheckIcon className="size-[18px]" style={{ color: A.green }} />
          ) : (
            <ClipboardIcon className="size-[18px]" />
          )}
        </ControlButton>
        <ControlButton active={showList} onClick={() => setShowList((s) => !s)} title="Annotations">
          <ListIcon className="size-[18px]" />
        </ControlButton>
        <ControlButton danger onClick={onClear} disabled={count === 0} title="Clear all">
          <Trash2Icon className="size-[18px]" />
        </ControlButton>
      </div>
    </div>
  );
}

/** A 34px circular toolbar control button (agentation's `.controlButton`). */
function ControlButton({
  children,
  onClick,
  title,
  active = false,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-active={active || undefined}
      data-danger={danger || undefined}
      className={cn(
        "flex size-[34px] items-center justify-center rounded-full text-white/85 transition-colors active:scale-95",
        "disabled:cursor-not-allowed disabled:opacity-35",
        !active && "hover:bg-white/[0.12] hover:text-white",
      )}
      style={
        active
          ? {
              color: danger ? A.red : A.accent,
              background: `color-mix(in srgb, ${danger ? A.red : A.accent} 25%, transparent)`,
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}
