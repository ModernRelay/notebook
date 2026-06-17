import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture } from "./loader.js";

function tmpFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "omnigraph-fixture-"));
  const path = join(dir, "f.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe("loadFixture", () => {
  it("loads a valid fixture", () => {
    const path = tmpFile({
      version: 1,
      title: "ok",
      nodes: [
        { type: "Actor", id: "a" },
        { type: "Decision", id: "d" },
      ],
      edges: [{ type: "owns", from: "a", to: "d" }],
    });
    expect(loadFixture(path).nodes).toHaveLength(2);
  });

  it("rejects orphan edges", () => {
    const path = tmpFile({
      version: 1,
      title: "bad",
      nodes: [{ type: "Actor", id: "a" }],
      edges: [{ type: "owns", from: "a", to: "missing" }],
    });
    expect(() => loadFixture(path)).toThrow(/unknown nodes/);
  });

  it("rejects duplicate node ids", () => {
    const path = tmpFile({
      version: 1,
      title: "bad",
      nodes: [
        { type: "Actor", id: "a" },
        { type: "Decision", id: "a" },
      ],
      edges: [],
    });
    expect(() => loadFixture(path)).toThrow(/duplicate/);
  });

  it("loads the company-context fixture", () => {
    const path = fileURLToPath(
      new URL(
        "../../../examples/fixtures/company-context.json",
        import.meta.url,
      ),
    );
    const fix = loadFixture(path);
    expect(fix.nodes.length).toBe(69);
    expect(fix.edges.length).toBe(129);
  });
});
