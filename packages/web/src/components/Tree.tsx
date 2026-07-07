import React, { useMemo, useState } from "react";
import { useActions, useStateValue } from "@json-render/react";
import {
  buildForest,
  type TreeNode,
  type TreeRuntimeProps,
} from "@modernrelay/notebook-core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ComponentCtx<P> {
  props: P;
}

/**
 * Tree lens — a collapsible forest grouped from path-shaped rows (one row per
 * root→leaf chain; `levels` names the column pairs). Clicking a node label
 * writes THAT node's key value to `select_state` (Table's mechanism), so any
 * level drives dependent cells. Disclosure state is per-node local UI state.
 */
export function Tree({
  props: p,
}: ComponentCtx<TreeRuntimeProps>): React.ReactElement {
  const actions = useActions();
  const selected = useStateValue<string>(p.select_state ?? "/__never__");
  const forest = useMemo(
    () => buildForest(p.rows, p.levels),
    [p.rows, p.levels],
  );
  // Disclosure = default policy + explicit user toggles. Deriving the default
  // per node (instead of materializing a set once) keeps re-read forests
  // correct: new paths get the expand_depth default; the user's explicit
  // opens/closes survive by path identity.
  const defaultOpen = (node: TreeNode): boolean =>
    node.children.length > 0 &&
    (p.expand_depth === undefined || node.depth < p.expand_depth);
  const [userToggled, setUserToggled] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const isOpen = (node: TreeNode): boolean =>
    userToggled.get(node.path) ?? defaultOpen(node);
  const toggle = (node: TreeNode): void => {
    setUserToggled((prev) => new Map(prev).set(node.path, !isOpen(node)));
  };

  if (forest.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        {p.empty_text ?? "(no rows)"}
      </p>
    );
  }

  const selectable = Boolean(p.select_state);
  const showCounts = p.counts !== false;

  const renderNode = (node: TreeNode): React.ReactElement => {
    const hasChildren = node.children.length > 0;
    const open = isOpen(node);
    const isSelected = selectable && node.key === selected;
    return (
      <li key={node.path}>
        <div className="flex items-center gap-1">
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${node.label}`}
              onClick={() => toggle(node)}
              className="w-4 shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4 shrink-0" aria-hidden />
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-sm",
              node.depth === 0 && "font-medium",
              selectable && "cursor-pointer hover:bg-muted/50",
              isSelected && "bg-accent",
            )}
            {...(selectable
              ? {
                  onClick: () =>
                    actions.execute({
                      action: "setState",
                      params: { statePath: p.select_state, value: node.key },
                    }),
                }
              : {})}
          >
            {node.label}
          </span>
          {showCounts && hasChildren && (
            <Badge variant="outline" className="text-xs tabular-nums">
              {node.children.length}
            </Badge>
          )}
        </div>
        {hasChildren && open && (
          <ul className="ml-4 border-l border-border pl-2">
            {node.children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div>
      {p.title && (
        <p className="mb-1 text-sm font-medium text-foreground">{p.title}</p>
      )}
      <ul className="space-y-0.5">{forest.map(renderNode)}</ul>
    </div>
  );
}
