import { describe, it, expect } from "vitest";
import { inkCatalog, inkRegistry } from "./registry.js";

describe("ink registry", () => {
  it("loads without source or mutation globals", () => {
    expect(inkCatalog).toBeDefined();
    expect(inkRegistry).toBeDefined();
  });
});
