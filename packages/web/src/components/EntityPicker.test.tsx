// @vitest-environment happy-dom
//
// EntityPicker unit coverage: item derivation + bound-value display. The
// popup interaction (type-to-filter, click/Enter committing the row VALUE)
// depends on Base UI's Positioner, which needs real layout APIs happy-dom
// lacks — that path is exercised in the live headed verification instead.
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EntityPicker } from "./EntityPicker.js";

const ROWS = [
  { slug: "alice", name: "Alice Ng" },
  { slug: "bob", name: "Bob Reyes" },
  { slug: "", name: "No-key row (filtered)" },
];

function mount(
  props: Partial<React.ComponentProps<typeof EntityPicker>> = {},
): { host: HTMLDivElement; root: Root; onChange: ReturnType<typeof vi.fn> } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onChange = vi.fn((_value: string) => {});
  act(() => {
    root.render(
      <EntityPicker
        rows={ROWS}
        valueColumn="slug"
        labelColumn="name"
        value=""
        onValueChange={onChange}
        {...props}
      />,
    );
  });
  return { host, root, onChange };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("EntityPicker", () => {
  it("renders a text input with the placeholder", () => {
    const { host, root } = mount({ placeholder: "Search reviewers…" });
    const input = host.querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe("Search reviewers…");
    act(() => root.unmount());
  });

  it("shows the bound value's LABEL; falls back to the raw value when rows lack it", () => {
    const bound = mount({ value: "bob" });
    expect((bound.host.querySelector("input") as HTMLInputElement).value).toBe(
      "Bob Reyes",
    );
    act(() => bound.root.unmount());

    const stale = mount({ value: "ghost" }); // rows stale/loading
    expect((stale.host.querySelector("input") as HTMLInputElement).value).toBe(
      "ghost",
    );
    act(() => stale.root.unmount());
  });

  it("clearing the input clears the bound value", () => {
    const { host, root, onChange } = mount({ value: "bob" });
    const input = host.querySelector("input") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("");
    act(() => root.unmount());
  });

  it("resyncs the input text when the bound value changes externally", () => {
    const { host, root, onChange } = mount({ value: "alice" });
    expect((host.querySelector("input") as HTMLInputElement).value).toBe(
      "Alice Ng",
    );
    act(() => {
      root.render(
        <EntityPicker
          rows={ROWS}
          valueColumn="slug"
          labelColumn="name"
          value="bob"
          onValueChange={() => {}}
        />,
      );
    });
    void onChange;
    expect((host.querySelector("input") as HTMLInputElement).value).toBe(
      "Bob Reyes",
    );
    act(() => root.unmount());
  });
});
