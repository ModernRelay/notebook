// @vitest-environment happy-dom
//
// BranchBar: switch/create/review/merge chrome. The popovers are plain
// positioned divs (not Base UI), so happy-dom drives them fully.
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Client } from "@modernrelay/notebook-client";
import { ToastProvider } from "@/components/ui/toast";
import { BranchBar } from "./BranchBar.js";

const snap = (
  branch: string,
  tables: Array<[string, number, number]>,
): { branch: string; manifest_version: number; tables: { table_key: string; version: number; row_count: number }[] } => ({
  branch,
  manifest_version: 1,
  tables: tables.map(([table_key, version, row_count]) => ({
    table_key,
    version,
    row_count,
  })),
});

function fakeClient(overrides: Partial<Record<keyof Client, unknown>> = {}): Client {
  return {
    branches: vi.fn(async () => ({ branches: ["main", "stage"] })),
    snapshot: vi.fn(async (branch: string) =>
      branch === "main"
        ? snap("main", [["node:Task", 14, 10]])
        : snap("stage", [["node:Task", 16, 12]]),
    ),
    createBranch: vi.fn(async () => undefined),
    mergeBranch: vi.fn(async () => ({ ok: true, outcome: "merged" })),
    deleteBranch: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as Client;
}

async function mount(
  client: Client,
  props: Partial<React.ComponentProps<typeof BranchBar>> = {},
): Promise<{ host: HTMLDivElement; root: Root; onSwitch: ReturnType<typeof vi.fn> }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onSwitch = vi.fn((_b: string) => {});
  await act(async () => {
    root.render(
      <ToastProvider>
        <BranchBar
          client={client}
          current="stage"
          baseBranch="main"
          onSwitch={onSwitch}
          {...props}
        />
      </ToastProvider>,
    );
  });
  return { host, root, onSwitch };
}

const byText = (host: HTMLElement, text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("BranchBar", () => {
  it("shows the current branch; the menu lists branches and switches", async () => {
    const client = fakeClient();
    const { host, root, onSwitch } = await mount(client);
    const picker = byText(host, "stage")!;
    expect(picker).toBeTruthy();
    await act(async () => picker.click());
    const mainItem = byText(host, "main")!;
    await act(async () => mainItem.click());
    expect(onSwitch).toHaveBeenCalledWith("main");
    act(() => root.unmount());
  });

  it("creates a branch (prefilled work-<date>) from the current one and switches to it", async () => {
    const client = fakeClient();
    const { host, root, onSwitch } = await mount(client);
    await act(async () => byText(host, "stage")!.click());
    await act(async () => byText(host, "New branch")!.click());
    const input = host.querySelector("input") as HTMLInputElement;
    expect(input.value).toMatch(/^work-\d{4}-\d{2}-\d{2}$/);
    await act(async () => byText(host, "Create")!.click());
    expect(client.createBranch).toHaveBeenCalledWith(input.value, "stage");
    expect(onSwitch).toHaveBeenCalledWith(input.value);
    act(() => root.unmount());
  });

  it("review popover shows table deltas; merge is two-step and reports the outcome", async () => {
    const client = fakeClient();
    const { host, root } = await mount(client);
    await act(async () => byText(host, "Review & merge")!.click());
    const list = host.querySelector('[data-testid="delta-list"]');
    expect(list?.textContent).toContain("Task");
    expect(list?.textContent).toContain("+2 rows");
    expect(list?.textContent).toContain("v14 → v16");

    const mergeBtn = byText(host, "Merge into main")!;
    await act(async () => mergeBtn.click()); // arm
    expect(client.mergeBranch).not.toHaveBeenCalled();
    await act(async () => byText(host, "Confirm merge into main")!.click()); // fire
    expect(client.mergeBranch).toHaveBeenCalledWith("stage", "main");
    expect(host.textContent).toContain("The branch still");
    act(() => root.unmount());
  });

  it("renders the structured conflict list on a blocked merge", async () => {
    const client = fakeClient({
      mergeBranch: vi.fn(async () => ({
        ok: false,
        conflicts: [
          {
            table_key: "node:Task",
            row_id: "t1",
            kind: "DivergentUpdate",
            message: "status changed on both branches",
          },
        ],
      })),
    });
    const { host, root } = await mount(client);
    await act(async () => byText(host, "Review & merge")!.click());
    await act(async () => byText(host, "Merge into main")!.click());
    await act(async () => byText(host, "Confirm merge into main")!.click());
    const conflicts = host.querySelector('[data-testid="conflict-list"]');
    expect(conflicts?.textContent).toContain("Task");
    expect(conflicts?.textContent).toContain("/t1");
    expect(conflicts?.textContent).toContain("DivergentUpdate");
    expect(host.textContent).toContain("main is untouched");
    act(() => root.unmount());
  });

  it("merge disabled when the branch has no staged changes", async () => {
    const client = fakeClient({
      snapshot: vi.fn(async () => snap("x", [["node:Task", 14, 10]])),
    });
    const { host, root } = await mount(client);
    await act(async () => byText(host, "Review & merge")!.click());
    expect(host.textContent).toContain("No changes yet");
    expect(byText(host, "Merge into main")!.disabled).toBe(true);
    act(() => root.unmount());
  });

  it("hides Review & merge on the base branch itself", async () => {
    const client = fakeClient();
    const { host, root } = await mount(client, { current: "main" });
    expect(byText(host, "Review & merge")).toBeUndefined();
    act(() => root.unmount());
  });
});
