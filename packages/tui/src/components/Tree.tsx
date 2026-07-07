import React, { useMemo, useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import { useActions, useStateValue } from "@json-render/ink";
import {
  buildForest,
  type TreeNode,
  type TreeRuntimeProps,
} from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

const VISIBLE_LINES = 14;

interface VisibleLine {
  node: TreeNode;
  prefix: string;
}

/** Flatten the expanded forest into display lines with box-drawing prefixes. */
function visibleLines(
  nodes: TreeNode[],
  expanded: ReadonlySet<string>,
  ancestors = "",
): VisibleLine[] {
  const out: VisibleLine[] = [];
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1;
    const branch = node.depth === 0 ? "" : last ? "└─ " : "├─ ";
    out.push({ node, prefix: ancestors + branch });
    if (node.children.length > 0 && expanded.has(node.path)) {
      const carry = node.depth === 0 ? "" : last ? "   " : "│  ";
      out.push(...visibleLines(node.children, expanded, ancestors + carry));
    }
  });
  return out;
}

/**
 * Tree lens (ink) — the expanded forest as box-drawing lines. ↑/↓ move the
 * cursor, ←/→ collapse/expand the focused node, Enter/space writes the
 * node's key value to `select_state` (same dispatch as Table).
 */
export function Tree({
  props: p,
}: ComponentCtx<TreeRuntimeProps>): React.ReactElement {
  const actions = useActions();
  const selectable = Boolean(p.select_state);
  const { isFocused } = useFocus({ autoFocus: selectable });
  const selected = useStateValue<string>(p.select_state ?? "/__never__");
  const forest = useMemo(() => buildForest(p.rows, p.levels), [p.rows, p.levels]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>();
    const walk = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        if (
          node.children.length > 0 &&
          (p.expand_depth === undefined || node.depth < p.expand_depth)
        ) {
          open.add(node.path);
        }
        walk(node.children);
      }
    };
    walk(forest);
    return open;
  });
  const [cursor, setCursor] = useState(0);

  const lines = visibleLines(forest, expanded);
  const total = lines.length;

  useInput(
    (input, key) => {
      if (total === 0) return;
      const line = lines[Math.min(cursor, total - 1)];
      if (key.upArrow) setCursor((c) => (c - 1 + total) % total);
      else if (key.downArrow) setCursor((c) => (c + 1) % total);
      else if (key.leftArrow && line) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(line.node.path);
          return next;
        });
      } else if (key.rightArrow && line && line.node.children.length > 0) {
        setExpanded((prev) => new Set(prev).add(line.node.path));
      } else if ((key.return || input === " ") && line && selectable) {
        actions.execute({
          action: "setState",
          params: { statePath: p.select_state, value: line.node.key },
        });
      }
    },
    { isActive: isFocused },
  );

  if (total === 0) {
    return <Text dimColor>{p.empty_text ?? "(no rows)"}</Text>;
  }

  const cur = Math.min(cursor, total - 1);
  const start = Math.max(
    0,
    Math.min(cur - Math.floor(VISIBLE_LINES / 2), total - VISIBLE_LINES),
  );
  const window = lines.slice(start, start + VISIBLE_LINES);
  const showCounts = p.counts !== false;

  return (
    <Box flexDirection="column">
      {p.title && <Text bold>{p.title}</Text>}
      {window.map((line, i) => {
        const index = start + i;
        const isCursor = isFocused && index === cur;
        const isSelected = selectable && line.node.key === selected;
        const hasChildren = line.node.children.length > 0;
        const disclosure = hasChildren
          ? expanded.has(line.node.path)
            ? "▾ "
            : "▸ "
          : "";
        return (
          <Box key={line.node.path}>
            <Text color={isCursor ? "cyan" : isSelected ? "green" : undefined}>
              {isCursor ? "▶ " : isSelected ? "● " : "  "}
              <Text dimColor>{line.prefix}</Text>
              {disclosure}
              <Text bold={line.node.depth === 0}>{line.node.label}</Text>
              {showCounts && hasChildren && (
                <Text dimColor> ({line.node.children.length})</Text>
              )}
            </Text>
          </Box>
        );
      })}
      {total > VISIBLE_LINES && (
        <Text dimColor>
          {" "}
          {cur + 1}/{total}
        </Text>
      )}
      {isFocused && (
        <Text dimColor> ↑/↓ move · ←/→ fold{selectable ? " · Enter select" : ""}</Text>
      )}
    </Box>
  );
}
