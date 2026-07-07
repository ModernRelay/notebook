// @vitest-environment happy-dom
//
// Tree lens through the REAL registry: forest grouping renders nested,
// disclosure collapses, node click writes select_state.
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { assembleLensSpec, type QueryResult } from "@modernrelay/notebook-core";
import { webRegistry } from "../registry.js";

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

function treeSpec(extra: Record<string, unknown> = {}) {
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
    result(ROWS),
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

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Tree lens (web)", () => {
  it("renders the grouped forest with counts", () => {
    const { host, root } = mount(treeSpec());
    const text = host.textContent ?? "";
    expect(text).toContain("Systems");
    expect(text).toContain("Cognitive");
    expect(text).toContain("Feedback loops");
    expect(text).toContain("Attractors");
    // Systems has 2 concepts; Feedback loops has 2 related
    const badges = Array.from(host.querySelectorAll("li > div > [class*='badge'], li > div > span[class*='tabular']")).map((b) => b.textContent);
    expect(badges).toContain("2");
    act(() => root.unmount());
  });

  it("disclosure collapses a branch", () => {
    const { host, root } = mount(treeSpec());
    const collapseSystems = Array.from(host.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Collapse Systems",
    )!;
    expect(host.textContent).toContain("Feedback loops");
    act(() => {
      collapseSystems.click();
    });
    // Systems' subtree hidden; Cognitive's still visible
    expect(host.textContent).not.toContain("Chunking");
    expect(host.textContent).toContain("Bias");
    act(() => root.unmount());
  });

  it("expand_depth: 0 starts fully collapsed", () => {
    const { host, root } = mount(treeSpec({ expand_depth: 0 }));
    expect(host.textContent).toContain("Systems");
    expect(host.textContent).not.toContain("Feedback loops");
    act(() => root.unmount());
  });

  it("node click writes its key value to select_state (highlight follows)", () => {
    const { host, root } = mount(treeSpec());
    const chunking = Array.from(host.querySelectorAll("span")).find(
      (s) => s.textContent === "Chunking",
    )!;
    act(() => {
      chunking.click();
    });
    // selection is the KEY value; the highlight class lands on the node
    expect(chunking.className).toContain("bg-accent");
    // a different node with the same label elsewhere isn't highlighted
    const systems = Array.from(host.querySelectorAll("span")).find(
      (s) => s.textContent === "Systems",
    )!;
    expect(systems.className).not.toContain("bg-accent");
    act(() => root.unmount());
  });

  it("re-read rows keep the default-open policy for NEW branches; user toggles survive", () => {
    const { host, root, rerender } = mount(treeSpec());
    // user collapses Systems
    act(() => {
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.getAttribute("aria-label") === "Collapse Systems")!
        .click();
    });
    expect(host.textContent).not.toContain("Chunking");
    // a background re-read adds a brand-new domain
    const grown = assembleLensSpec(
      "tree",
      "Tree",
      {
        levels: [
          { key: "d", label: "dn" },
          { key: "c", label: "cn" },
          { key: "r", label: "rn" },
        ],
        select_state: "/selected",
      },
      result([
        ...ROWS,
        { d: "phys", dn: "Physics", c: "entropy", cn: "Entropy", r: "attr", rn: "Attractors" },
      ]),
    );
    rerender(grown);
    // the NEW domain follows the default policy (open — no expand_depth set)
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
