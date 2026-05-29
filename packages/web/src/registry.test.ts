import { describe, it, expect } from "vitest";
import { webCatalog, webRegistry } from "./registry.js";

describe("web registry", () => {
  it("loads without source or mutation globals", () => {
    expect(webCatalog).toBeDefined();
    expect(webRegistry).toBeDefined();
  });
});
