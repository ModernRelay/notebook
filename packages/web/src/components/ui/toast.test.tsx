// @vitest-environment happy-dom
//
// Success-toast surface: the bridge fires one toast per distinct dispatch
// seq, toasts auto-dismiss on the provider timeout, and an unchanged seq
// never replays.
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MutationFeedback } from "@modernrelay/notebook-core";
import { ToastProvider } from "./toast.js";
import { SuccessToastBridge } from "../../App.js";

function mount(feedback: MutationFeedback | null): {
  host: HTMLDivElement;
  root: Root;
  rerender: (f: MutationFeedback | null) => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (f: MutationFeedback | null): void => {
    act(() => {
      root.render(
        <ToastProvider>
          <SuccessToastBridge feedback={f} />
        </ToastProvider>,
      );
    });
  };
  render(feedback);
  return { host, root, rerender: render };
}

const toastTexts = (): string[] =>
  Array.from(document.querySelectorAll("[role=status]"))
    .map((el) => el.textContent ?? "")
    .filter((t) => t.length > 0);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SuccessToastBridge + ToastProvider", () => {
  it("fires a toast when the feedback seq changes, not on mount", () => {
    vi.useFakeTimers();
    const { rerender, root } = mount({
      kind: "success",
      message: "Saved — pre-mount",
      seq: 1,
    });
    // Mount-time feedback is NOT replayed.
    expect(toastTexts().join(" ")).not.toContain("pre-mount");

    rerender({ kind: "success", message: "Saved — 1 row", seq: 2 });
    expect(toastTexts().join(" ")).toContain("Saved — 1 row");

    // Same seq again → no duplicate.
    rerender({ kind: "success", message: "Saved — 1 row", seq: 2 });
    const count = toastTexts().filter((t) => t.includes("Saved — 1 row")).length;
    expect(count).toBe(1);
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("auto-dismisses after the provider timeout", () => {
    vi.useFakeTimers();
    const { rerender, root } = mount(null);
    rerender({ kind: "success", message: "Saved — 3 rows", seq: 7 });
    expect(toastTexts().join(" ")).toContain("Saved — 3 rows");

    act(() => {
      vi.advanceTimersByTime(6000); // past the 4s timeout + animation
    });
    expect(toastTexts().join(" ")).not.toContain("Saved — 3 rows");
    act(() => root.unmount());
    vi.useRealTimers();
  });
});
