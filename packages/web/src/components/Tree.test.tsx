// @vitest-environment happy-dom
//
// Tree lens over @headless-tree, through the REAL registry: ARIA tree
// pattern, keyboard navigation, typeahead search, entity-level selection,
// and the re-read-safe disclosure policy.
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { assembleLensSpec, type QueryResult } from "@modernrelay/notebook-core";
import { webRegistry } from "../registry.js";

// headless-tree's internal state updates run through React setState in
// effects/handlers; mark the env so act() covers them.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = [
  { d: "sys", dn: "Systems", c: "loop", cn: "Feedback loops", r: "attr", rn: "Attractors" },
  { d: "sys", dn: "Systems", c: "loop", cn: "Feedback loops", r: "emer", rn: "Emergence" },
  { d: "sys", dn: "Systems", c: "chunk", cn: "Chunking", r: "attr", rn: "Attractors" },
  { d: "cog", dn: "Cognitive", c: "bias", cn: "Bias", r: "loop", rn: "Feedback loops" },
];

const result = (rows: Record<string, unknown>[]): QueryResult => ({
  query_name: "q",
  target: "main",
  row_count: rows.length,
  columns: Object.keys(rows[0] ?? {}),
  rows,
});

function treeSpec(extra: Record<string, unknown> = {}, rows = ROWS) {
  return assembleLensSpec(
    "tree",
    "Tree",
    {
      levels: [
        { key: "d", label: "dn" },
        { key: "c", label: "cn" },
        { key: "r", label: "rn" },
      ],
      select_state: "/selected",
      ...extra,
    },
    result(rows),
  );
}

function mount(spec: ReturnType<typeof treeSpec>): {
  host: HTMLDivElement;
  root: Root;
  rerender: (s: ReturnType<typeof treeSpec>) => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (s: ReturnType<typeof treeSpec>): void => {
    act(() => {
      root.render(
        <JSONUIProvider registry={webRegistry} initialState={{}} handlers={{}}>
          <Renderer spec={s} registry={webRegistry} />
        </JSONUIProvider>,
      );
    });
  };
  render(spec);
  return { host, root, rerender: render };
}

const itemByLabel = (host: HTMLElement, label: string): HTMLElement => {
  const el = Array.from(
    host.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  ).find((it) => it.textContent?.includes(label));
  if (el === undefined) {
    throw new Error(`no treeitem labeled "${label}" — tree has: ${Array.from(
      host.querySelectorAll('[role="treeitem"]'),
    )
      .map((it) => it.textContent)
      .join(" | ")}`);
  }
  return el;
};

const click = (el: HTMLElement): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

// Hotkey matching tracks HELD keys (keydown on the tree, keyup on document)
// — release after every press or the next hotkey sees a chord.
const key = (el: HTMLElement, k: string, code?: string): void => {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, code: code ?? k, bubbles: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", { key: k, code: code ?? k, bubbles: true }),
    );
  });
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Tree lens (web, headless-tree)", () => {
  it("renders the grouped forest with the ARIA tree pattern and counts", () => {
    const { host, root } = mount(treeSpec());
    expect(host.querySelector('[role="tree"]')).toBeTruthy();
    const items = Array.from(host.querySelectorAll('[role="treeitem"]'));
    expect(items.length).toBeGreaterThanOrEqual(7); // 2 domains + 3 concepts + leaves
    const systems = itemByLabel(host, "Systems");
    expect(systems.getAttribute("aria-level")).toBe("1");
    expect(systems.getAttribute("aria-expanded")).toBe("true");
    const loops = itemByLabel(host, "Feedback loops");
    expect(loops.getAttribute("aria-level")).toBe("2");
    // count badges: Systems (2 concepts), Feedback loops (2 related)
    expect(systems.textContent).toContain("2");
    expect(loops.textContent).toContain("2");
    // roving tabindex: exactly one 0
    const tabZero = items.filter((i) => i.getAttribute("tabindex") === "0");
    expect(tabZero.length).toBe(1);
    act(() => root.unmount());
  });

  it("row click collapses an expanded branch", () => {
    const { host, root } = mount(treeSpec());
    expect(host.textContent).toContain("Chunking");
    click(itemByLabel(host, "Systems"));
    expect(host.textContent).not.toContain("Chunking");
    expect(host.textContent).toContain("Bias"); // Cognitive untouched
    act(() => root.unmount());
  });

  it("expand_depth: 0 starts fully collapsed", () => {
    const { host, root } = mount(treeSpec({ expand_depth: 0 }));
    expect(host.textContent).toContain("Systems");
    expect(host.textContent).not.toContain("Feedback loops");
    act(() => root.unmount());
  });

  it("node click writes its key to select_state; every occurrence of the entity highlights", () => {
    const { host, root } = mount(treeSpec());
    // duplicate-entity case FIRST (a later Chunking click collapses its
    // subtree, hiding one Attractors occurrence): both occurrences highlight
    click(itemByLabel(host, "Attractors"));
    const attractors = Array.from(
      host.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ).filter((el) => el.textContent?.includes("Attractors"));
    expect(attractors.length).toBe(2);
    for (const el of attractors) expect(el.className).toContain("bg-accent");
    // single-entity: clicking Chunking moves the selection (and toggles it)
    click(itemByLabel(host, "Chunking"));
    expect(itemByLabel(host, "Chunking").className).toContain("bg-accent");
    expect(itemByLabel(host, "Systems").className).not.toContain("bg-accent");
    act(() => root.unmount());
  });

  it("keyboard: ArrowDown moves focus; ArrowRight expands a collapsed folder", () => {
    const { host, root } = mount(treeSpec({ expand_depth: 1 }));
    const systems = itemByLabel(host, "Systems");
    act(() => systems.focus());
    key(systems, "ArrowDown");
    const loops = itemByLabel(host, "Feedback loops");
    expect(loops.getAttribute("tabindex")).toBe("0"); // roving focus moved
    expect(loops.getAttribute("aria-expanded")).toBe("false");
    act(() => loops.focus());
    key(loops, "ArrowRight");
    expect(host.textContent).toContain("Emergence"); // children now visible
    act(() => root.unmount());
  });

  it("typeahead opens search and marks matches", () => {
    const { host, root } = mount(treeSpec());
    const systems = itemByLabel(host, "Systems");
    act(() => systems.focus());
    key(systems, "b", "KeyB"); // typeahead matches the event CODE
    const input = host.querySelector('input[aria-label="Search tree"]');
    expect(input).toBeTruthy();
    const bias = itemByLabel(host, "Bias");
    expect(bias.className).toContain("ring-primary");
    act(() => root.unmount());
  });

  it("re-read rows keep the default-open policy for NEW branches; user toggles survive", () => {
    const { host, root, rerender } = mount(treeSpec());
    click(itemByLabel(host, "Systems")); // user collapses Systems
    expect(host.textContent).not.toContain("Chunking");
    rerender(
      treeSpec({}, [
        ...ROWS,
        { d: "phys", dn: "Physics", c: "entropy", cn: "Entropy", r: "attr", rn: "Attractors" },
      ]),
    );
    // the NEW domain follows the default policy (open — no expand_depth)
    expect(host.textContent).toContain("Physics");
    expect(host.textContent).toContain("Entropy");
    // the user's explicit collapse of Systems SURVIVES the re-read
    expect(host.textContent).not.toContain("Chunking");
    act(() => root.unmount());
  });

  it("shows empty_text for zero rows", () => {
    const spec = assembleLensSpec(
      "tree",
      "Tree",
      { levels: [{ key: "d" }, { key: "c" }], empty_text: "No paths." },
      result([]),
    );
    const { host, root } = mount(spec);
    expect(host.textContent).toContain("No paths.");
    act(() => root.unmount());
  });
});
