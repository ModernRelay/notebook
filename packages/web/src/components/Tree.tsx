import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useActions, useStateValue } from "@json-render/react";
import {
  hotkeysCoreFeature,
  searchFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
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

const ROOT_ID = "__root__";

/**
 * Tree lens — a collapsible forest grouped from path-shaped rows, rendered
 * over @headless-tree (W3C ARIA tree pattern: roving tabindex, arrow-key
 * navigation, Home/End, type-to-search). Selection is ENTITY-level: a node
 * click/Enter writes the node's KEY value to `select_state`, and every
 * occurrence of the selected entity in the forest highlights together.
 * Row click also toggles folders (the standard tree pattern); disclosure
 * state = the expand_depth default overlaid with explicit user toggles, so
 * a query re-read gives NEW branches the default while user folds survive.
 */
export function Tree({
  props: p,
}: ComponentCtx<TreeRuntimeProps>): React.ReactElement {
  const actions = useActions();
  const selected = useStateValue<string>(p.select_state ?? "/__never__");
  const selectable = Boolean(p.select_state);

  // Forest + path index rebuilt when the query rows change. The synthetic
  // root holds the forest roots as children (headless-tree needs one root).
  const { byPath, forest } = useMemo(() => {
    const forest = buildForest(p.rows, p.levels);
    const byPath = new Map<string, TreeNode>();
    const walk = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        byPath.set(node.path, node);
        walk(node.children);
      }
    };
    walk(forest);
    byPath.set(ROOT_ID, {
      key: "",
      label: p.title ?? "root",
      path: ROOT_ID,
      depth: -1,
      children: forest,
    });
    return { byPath, forest };
  }, [p.rows, p.levels, p.title]);

  const defaultOpen = useCallback(
    (node: TreeNode): boolean =>
      node.children.length > 0 &&
      (p.expand_depth === undefined || node.depth < p.expand_depth),
    [p.expand_depth],
  );

  // Disclosure = default policy + explicit user toggles (re-read safe: new
  // paths aren't in the toggle map, so they get the expand_depth default).
  const [userToggled, setUserToggled] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const computeExpanded = useCallback(
    (toggled: ReadonlyMap<string, boolean>): string[] => {
      const open: string[] = [ROOT_ID];
      for (const node of byPath.values()) {
        if (node.path === ROOT_ID) continue;
        if (toggled.get(node.path) ?? defaultOpen(node)) open.push(node.path);
      }
      return open;
    },
    [byPath, defaultOpen],
  );
  const expandedItems = useMemo(
    () => computeExpanded(userToggled),
    [computeExpanded, userToggled],
  );
  const setExpandedItems = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      // "Current" is derived INSIDE the state updater from the accumulated
      // toggle map, so a functional updater sees the true latest expansion
      // even across batched sequential calls (not a render-time snapshot).
      setUserToggled((prevToggled) => {
        const currentArr = computeExpanded(prevToggled);
        const current = new Set(currentArr);
        const nextArr =
          typeof updater === "function" ? updater(currentArr) : updater;
        const next = new Set(nextArr);
        const toggled = new Map(prevToggled);
        for (const path of next) {
          if (!current.has(path)) toggled.set(path, true);
        }
        for (const path of current) {
          if (!next.has(path) && path !== ROOT_ID) toggled.set(path, false);
        }
        return toggled;
      });
    },
    [computeExpanded],
  );

  // Entity-level selection: every path whose key matches the bound value.
  const selectedItems = useMemo(() => {
    if (!selectable || selected === undefined || selected === "") return [];
    const paths: string[] = [];
    for (const node of byPath.values()) {
      if (node.path !== ROOT_ID && node.key === selected) paths.push(node.path);
    }
    return paths;
  }, [byPath, selected, selectable]);

  const dispatchSelect = useCallback(
    (key: string) => {
      if (!selectable || key === "") return;
      actions.execute({
        action: "setState",
        params: { statePath: p.select_state, value: key },
      });
    },
    [actions, selectable, p.select_state],
  );

  const tree = useTree<TreeNode>({
    rootItemId: ROOT_ID,
    getItemName: (item) => item.getItemData()?.label ?? "",
    isItemFolder: (item) => (item.getItemData()?.children.length ?? 0) > 0,
    dataLoader: {
      getItem: (id) => byPath.get(id) as TreeNode,
      getChildren: (id) => (byPath.get(id)?.children ?? []).map((c) => c.path),
    },
    state: { expandedItems, selectedItems },
    setExpandedItems,
    // Selection is driven exclusively through the entity key in notebook
    // state (dispatch → useStateValue → derived selectedItems). The single
    // dispatch site is onPrimaryAction — both click and Enter route through
    // primaryAction, and dispatching from setSelectedItems too would double
    // the state patch (two invalidation cycles per click). The setter is
    // still required for controlled state; it intentionally does nothing.
    setSelectedItems: () => {},
    onPrimaryAction: (item) => {
      const data = item.getItemData();
      if (data !== undefined) dispatchSelect(data.key);
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      searchFeature,
    ],
  });

  // New rows → new forest → re-flatten from the root.
  useEffect(() => {
    tree.rebuildTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byPath]);

  if (forest.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        {p.empty_text ?? "(no rows)"}
      </p>
    );
  }

  const showCounts = p.counts !== false;

  return (
    <div>
      {p.title && (
        <p className="mb-1 text-sm font-medium text-foreground">{p.title}</p>
      )}
      {tree.isSearchOpen() && (
        <input
          {...tree.getSearchInputElementProps()}
          aria-label="Search tree"
          className="mb-1 w-56 rounded-md border border-border bg-background px-2 py-0.5 text-sm"
        />
      )}
      <div {...tree.getContainerProps(p.title ?? "Tree")} className="space-y-0.5">
        {tree.getItems().map((item) => {
          const node = item.getItemData();
          if (node === undefined) return null;
          const level = item.getItemMeta().level;
          const isFolder = item.isFolder();
          const isOpen = item.isExpanded();
          return (
            <div
              key={item.getId()}
              {...item.getProps()}
              style={{ paddingLeft: `${level * 16}px` }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-left text-sm",
                "hover:bg-muted/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                level === 0 && "font-medium",
                item.isSelected() && selectable && "bg-accent",
                item.isMatchingSearch() && "ring-1 ring-primary",
              )}
            >
              <span
                aria-hidden
                className="w-4 shrink-0 text-xs text-muted-foreground"
              >
                {isFolder ? (isOpen ? "▾" : "▸") : ""}
              </span>
              <span className="truncate">{node.label}</span>
              {showCounts && isFolder && (
                <Badge variant="outline" className="text-xs tabular-nums">
                  {node.children.length}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
