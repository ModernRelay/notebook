import React, { useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ClipboardIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Annotation, AnnotationSession } from "../annotations-store.js";

/**
 * Floating annotation panel (bottom-right). Lists the session grouped by cell,
 * holds the overall-instruction field, and copies the whole session to the
 * clipboard as agent-ready markdown. Shown whenever annotate mode is on or there
 * are annotations to manage.
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

  // Group by cell, preserving first-seen order.
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
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <ChevronDownIcon
            className={cn("size-4 transition-transform", collapsed && "-rotate-90")}
          />
          Annotations
          <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
            {session.items.length}
          </span>
        </button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={copy}
          disabled={session.items.length === 0}
          className="gap-1"
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-primary" />
          ) : (
            <ClipboardIcon className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy for agent"}
        </Button>
      </div>
      {!collapsed && (
        <div className="max-h-[60vh] overflow-y-auto p-3">
          <textarea
            value={session.instruction}
            onChange={(e) => onInstruction(e.target.value)}
            placeholder="Overall instruction for the agent (optional)…"
            rows={2}
            className="mb-3 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {session.items.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Click an entity to annotate it.
            </p>
          ) : (
            <ul className="space-y-3">
              {groups.map(([cellId, items]) => (
                <li key={cellId}>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    {cellId}
                  </div>
                  <ul className="space-y-1">
                    {items.map((a) => (
                      <li
                        key={a.id}
                        className="group flex items-start gap-2 rounded-md border border-border px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {a.intent && (
                              <span className="rounded-full border border-border px-1.5 text-[10px] capitalize text-muted-foreground">
                                {a.intent}
                              </span>
                            )}
                            <span className="truncate font-mono text-xs">
                              {a.key}
                            </span>
                          </div>
                          {a.note && (
                            <p className="mt-0.5 text-xs text-foreground">
                              {a.note}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label="Remove annotation"
                          onClick={() => onRemove(a.id)}
                          className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
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
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={onClear}
              >
                <Trash2Icon className="mr-1 size-3.5" /> Clear all
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
