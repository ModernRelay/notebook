import React, { useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ClipboardIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Annotation, AnnotationSession } from "../annotations-store.js";
import { A } from "./annotation-style.js";

/**
 * Floating annotation panel (bottom-right), styled as agentation's dark chrome
 * (#1a1a1a, soft layered shadow). Lists the session grouped by cell with the
 * 1-based marker numbers, holds the overall-instruction field, and copies the
 * whole session to the clipboard as agent-ready markdown.
 */
export function AnnotationPanel({
  session,
  onInstruction,
  onRemove,
  onClear,
  onCopy,
}: {
  session: AnnotationSession;
  onInstruction: (s: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCopy: () => Promise<boolean>;
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void onCopy().then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  // 1-based marker number per annotation (global order) + cell grouping.
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

  const ctrl =
    "flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div
      className="fixed bottom-5 right-5 w-80 max-w-[calc(100vw-2.5rem)] rounded-2xl text-white"
      style={{
        background: A.surface,
        boxShadow: A.barShadow,
        fontFamily: A.font,
        zIndex: 100000,
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <ChevronDownIcon
            className={cn("size-4 transition-transform", collapsed && "-rotate-90")}
          />
          Annotations
          <span
            className="inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[0.625rem] font-semibold text-white"
            style={{ background: A.blue }}
          >
            {session.items.length}
          </span>
        </button>
        <button
          type="button"
          onClick={copy}
          disabled={session.items.length === 0}
          className={ctrl}
        >
          {copied ? (
            <CheckIcon className="size-3.5" style={{ color: A.green }} />
          ) : (
            <ClipboardIcon className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy for agent"}
        </button>
      </div>
      {!collapsed && (
        <div className="max-h-[60vh] overflow-y-auto p-3">
          <textarea
            value={session.instruction}
            onChange={(e) => onInstruction(e.target.value)}
            placeholder="Overall instruction for the agent (optional)…"
            rows={2}
            className="mb-3 w-full resize-none rounded-lg border border-white/15 bg-white/5 px-2.5 py-2 text-[0.8125rem] text-white outline-none placeholder:text-white/30 focus:border-[color:var(--ag-accent)]"
            style={{ ["--ag-accent" as string]: A.blue }}
          />
          {session.items.length === 0 ? (
            <p className="py-4 text-center text-xs text-white/40">
              Click an entity to annotate it.
            </p>
          ) : (
            <ul className="space-y-3">
              {groups.map(([cellId, items]) => (
                <li key={cellId}>
                  <div className="mb-1 text-xs font-medium text-white/45">
                    {cellId}
                  </div>
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
                            <span className="truncate font-mono text-xs text-white/80">
                              {a.key}
                            </span>
                          </div>
                          {a.note && (
                            <p className="mt-0.5 text-xs text-white/85">{a.note}</p>
                          )}
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
          {session.items.length > 0 && (
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={onClear} className={ctrl}>
                <Trash2Icon className="size-3.5" /> Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
