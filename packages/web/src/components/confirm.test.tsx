// @vitest-environment happy-dom
//
// Inline two-step destructive guard: first activation arms (label swap + ✕
// cancel), second fires exactly once; the timer auto-disarms.
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { assembleLensSpec, assembleControlSpec } from "@modernrelay/notebook-core";
import { webRegistry } from "../registry.js";

function mount(
  spec: ReturnType<typeof assembleLensSpec>,
  mutate: (params: Record<string, unknown>) => Promise<void>,
): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <JSONUIProvider registry={webRegistry} initialState={{}} handlers={{ mutate }}>
        <Renderer spec={spec} registry={webRegistry} />
      </JSONUIProvider>,
    );
  });
  return { host, root };
}

const click = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

const button = (host: HTMLElement, text: string): HTMLButtonElement => {
  const b = Array.from(host.querySelectorAll("button")).find(
    (x) => x.textContent === text,
  );
  if (!b) throw new Error(`button "${text}" not found`);
  return b;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ActionList two-step confirm", () => {
  const SPEC = () =>
    assembleLensSpec(
      "list",
      "ActionList",
      {
        id_column: "id",
        title_column: "title",
        actions: [
          {
            label: "Delete",
            variant: "danger",
            mutation: {
              ref: "del",
              params: { slug: { $row: "id" } },
              confirm: "Really delete?",
              optimistic: { remove: true },
            },
          },
        ],
      },
      {
        query_name: "q",
        target: "main",
        row_count: 1,
        columns: ["id", "title"],
        rows: [{ id: "r1", title: "One" }],
      },
      { runtimeProps: { runtime: { cell_id: "list" } } },
    );

  it("first click arms (no dispatch), ✕ disarms, armed click fires once", () => {
    const mutate = vi.fn(async () => {});
    const { host, root } = mount(SPEC(), mutate);

    click(button(host, "Delete"));
    expect(mutate).not.toHaveBeenCalled(); // armed, not fired
    expect(button(host, "Really delete?")).toBeTruthy();

    click(button(host, "✕")); // cancel disarms
    expect(button(host, "Delete")).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();

    click(button(host, "Delete"));
    click(button(host, "Really delete?"));
    expect(mutate).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("auto-disarms after the timeout", () => {
    vi.useFakeTimers();
    const mutate = vi.fn(async () => {});
    const { host, root } = mount(SPEC(), mutate);
    click(button(host, "Delete"));
    expect(button(host, "Really delete?")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(button(host, "Delete")).toBeTruthy(); // back to rest
    expect(mutate).not.toHaveBeenCalled();
    act(() => root.unmount());
    vi.useRealTimers();
  });
});

describe("Button two-step confirm", () => {
  it("arms then fires the mutation once", () => {
    const mutate = vi.fn(async () => {});
    const spec = assembleControlSpec("btn", "Button", {
      label: "Unassign all",
      variant: "danger",
      mutation: { ref: "unassign", params: {}, confirm: true },
    });
    const { host, root } = mount(spec, mutate);

    click(button(host, "Unassign all"));
    expect(mutate).not.toHaveBeenCalled();
    click(button(host, "Confirm?"));
    expect(mutate).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
