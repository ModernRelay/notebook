import { describe, it, expect } from "vitest";
import { widthToColSpan } from "./layout.js";

describe("widthToColSpan", () => {
  it("maps each width to its literal 6-col span class", () => {
    expect(widthToColSpan("two-thirds")).toBe("md:col-span-4");
    expect(widthToColSpan("half")).toBe("md:col-span-3");
    expect(widthToColSpan("third")).toBe("md:col-span-2");
    expect(widthToColSpan("full")).toBe("md:col-span-6");
  });

  it("defaults absent width to a full row", () => {
    expect(widthToColSpan(undefined)).toBe("md:col-span-6");
  });
});
