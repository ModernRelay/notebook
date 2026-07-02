// @vitest-environment happy-dom
//
// Form lens behavior: dirty-only batch submit, requires guard, and the
// key_column remount reset — rendered through the real registry + provider,
// with the `mutate` handler stubbed (the runtime owns it in the app).
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { assembleLensSpec, type QueryResult } from "@modernrelay/notebook-core";
import { webRegistry } from "../registry.js";

const FIELDS = [
  {
    name: "title",
    kind: "text",
    required: true,
    mutation: {
      ref: "set_title",
      params: { slug: { $state: "/sel" }, title: { $input: "title" } },
    },
  },
  {
    name: "days",
    kind: "number",
    mutation: {
      ref: "set_days",
      params: { slug: { $state: "/sel" }, days: { $input: "days" } },
    },
  },
  {
    name: "priority",
    kind: "select",
    options: ["low", "high"],
    mutation: {
      ref: "set_priority",
      params: { slug: { $state: "/sel" }, priority: { $input: "priority" } },
    },
  },
];

function result(rows: Record<string, unknown>[]): QueryResult {
  return {
    query_name: "get_task",
    target: "main",
    row_count: rows.length,
    columns: ["slug", "title", "days", "priority"],
    rows,
  };
}

const ROW = { slug: "t3", title: "Old title", days: 3, priority: "low" };

function formSpec(rows: Record<string, unknown>[]) {
  return assembleLensSpec(
    "form",
    "Form",
    { fields: FIELDS, key_column: "slug" },
    result(rows),
    { runtimeProps: { runtime: { cell_id: "form", saving: false } } },
  );
}

function mount(
  spec: ReturnType<typeof formSpec>,
  mutate: (params: Record<string, unknown>) => Promise<void>,
): { host: HTMLDivElement; root: Root; rerender: (s: ReturnType<typeof formSpec>) => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (s: ReturnType<typeof formSpec>): void => {
    act(() => {
      root.render(
        <JSONUIProvider
          registry={webRegistry}
          initialState={{}}
          handlers={{ mutate }}
        >
          <Renderer spec={s} registry={webRegistry} />
        </JSONUIProvider>,
      );
    });
  };
  render(spec);
  return { host, root, rerender: render };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitButton(host: HTMLElement): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === "Save" || b.textContent === "Saving…",
  );
  if (!btn) throw new Error("submit button not found");
  return btn;
}

describe("Form lens (web)", () => {
  it("submit disabled at rest; editing one field dispatches ONLY that field's mutation with the full input map", async () => {
    const mutate = vi.fn(async (_params: Record<string, unknown>) => {});
    const { host, root } = mount(formSpec([ROW]), mutate);

    expect(submitButton(host).disabled).toBe(true); // zero dirty

    const title = host.querySelector("input:not([type])") as HTMLInputElement;
    setInputValue(title, "New title");
    expect(submitButton(host).disabled).toBe(false); // dirty + required set

    act(() => {
      submitButton(host).form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    const params = mutate.mock.calls[0]![0] as {
      mutations: { spec: { ref: string } }[];
      input: Record<string, unknown>;
      __cell_id: string;
    };
    expect(params.mutations.map((m) => m.spec.ref)).toEqual(["set_title"]);
    expect(params.input).toEqual({ title: "New title", days: 3, priority: "low" });
    expect(params.__cell_id).toBe("form");
    act(() => root.unmount());
  });

  it("clearing a required field blocks submit even with another field dirty", () => {
    const mutate = vi.fn(async () => {});
    const { host, root } = mount(formSpec([ROW]), mutate);

    const days = host.querySelector('input[type="number"]') as HTMLInputElement;
    setInputValue(days, "9");
    expect(submitButton(host).disabled).toBe(false);

    const title = host.querySelector("input:not([type])") as HTMLInputElement;
    setInputValue(title, "");
    expect(submitButton(host).disabled).toBe(true); // required title empty
    act(() => root.unmount());
  });

  it("reverting an edit back to the baseline value makes the form clean again", () => {
    const mutate = vi.fn(async () => {});
    const { host, root } = mount(formSpec([ROW]), mutate);

    const days = host.querySelector('input[type="number"]') as HTMLInputElement;
    setInputValue(days, "9");
    expect(submitButton(host).disabled).toBe(false);
    setInputValue(days, "3"); // numeric compare: "3" == baseline 3
    expect(submitButton(host).disabled).toBe(true);
    act(() => root.unmount());
  });

  it("switching the prefill row identity (key_column) resets in-progress edits", () => {
    const mutate = vi.fn(async () => {});
    const { host, root, rerender } = mount(formSpec([ROW]), mutate);

    const title = host.querySelector("input:not([type])") as HTMLInputElement;
    setInputValue(title, "Edited");
    expect(submitButton(host).disabled).toBe(false);

    rerender(formSpec([{ slug: "t5", title: "Other", days: 1, priority: "high" }]));
    const freshTitle = host.querySelector("input:not([type])") as HTMLInputElement;
    expect(freshTitle.value).toBe("Other"); // edit gone, new baseline shown
    expect(submitButton(host).disabled).toBe(true);
    act(() => root.unmount());
  });

  it("renders empty_text when an edit-form's query returns no rows", () => {
    const mutate = vi.fn(async () => {});
    const spec = assembleLensSpec(
      "form",
      "Form",
      { fields: FIELDS, key_column: "slug", empty_text: "Pick a task first." },
      result([]),
    );
    const { host, root } = mount(spec, mutate);
    expect(host.textContent).toContain("Pick a task first.");
    expect(host.querySelector("form")).toBeNull();
    act(() => root.unmount());
  });
});

describe("Form lens (web) — create-form (form-level mutations)", () => {
  const CREATE_SPEC = () =>
    assembleLensSpec(
      "form",
      "Form",
      {
        submit_label: "Add",
        fields: [
          { name: "slug", kind: "text", required: true },
          { name: "text", kind: "textarea", required: true },
        ],
        mutations: [
          {
            ref: "add_comment",
            params: { slug: { $input: "slug" }, text: { $input: "text" } },
          },
          {
            ref: "link_comment",
            params: { comment: { $input: "slug" }, task: "t1" },
          },
        ],
      },
      result([]),
      { runtimeProps: { runtime: { cell_id: "form", saving: false } } },
    );

  function addButton(host: HTMLElement): HTMLButtonElement {
    const btn = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Add",
    );
    if (!btn) throw new Error("Add button not found");
    return btn;
  }

  it("blank create-form renders (no rows, no key_column) with submit disabled", () => {
    const mutate = vi.fn(async () => {});
    const { host, root } = mount(CREATE_SPEC(), mutate);
    expect(host.querySelector("form")).not.toBeNull();
    expect(addButton(host).disabled).toBe(true); // required fields empty
    act(() => root.unmount());
  });

  it("filling both fields dispatches ALL form-level mutations with the input map", () => {
    const mutate = vi.fn(async (_params: Record<string, unknown>) => {});
    const { host, root } = mount(CREATE_SPEC(), mutate);

    const slug = host.querySelector("input") as HTMLInputElement;
    setInputValue(slug, "c9");
    const text = host.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(text, "hello");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(addButton(host).disabled).toBe(false);

    act(() => {
      addButton(host).form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    const params = mutate.mock.calls[0]![0] as {
      mutations: { spec: { ref: string } }[];
      input: Record<string, unknown>;
    };
    expect(params.mutations.map((m) => m.spec.ref)).toEqual([
      "add_comment",
      "link_comment",
    ]);
    expect(params.input).toEqual({ slug: "c9", text: "hello" });
    act(() => root.unmount());
  });
});
