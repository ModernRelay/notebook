// @vitest-environment happy-dom
//
// Regression guard: does the react-grid-layout API we actually use — the classic
// `WidthProvider(Responsive)` from `react-grid-layout/legacy` — mount under React
// 19 without the `findDOMNode is not a function` crash? Mounting a grid item
// exercises react-draggable (drag) + react-resizable (resize handles).
import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Responsive, WidthProvider } from "react-grid-layout/legacy";

const Grid = WidthProvider(Responsive);

describe("react-grid-layout (legacy) on React 19", () => {
  it("mounts a draggable + resizable item without a findDOMNode crash", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    expect(() => {
      act(() => {
        root.render(
          <Grid
            layouts={{ lg: [{ i: "a", x: 0, y: 0, w: 2, h: 2 }] }}
            breakpoints={{ lg: 0 }}
            cols={{ lg: 12 }}
            rowHeight={16}
            isDraggable
            isResizable
          >
            <div key="a">A</div>
          </Grid>,
        );
      });
    }).not.toThrow();
    act(() => root.unmount());
  });
});
