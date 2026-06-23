import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConfig } from "./config.js";

describe("buildConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses server URL, token, branch, and graph from query params", async () => {
    const storage = stubWindow(
      "http://127.0.0.1:5173/?server=http://example.test&token=tok&branch=review&graph=acme",
    );
    const config = await buildConfig();
    expect(config.label).toBe("server: http://example.test · graph: acme · review");
    // rawGq is off unless the explicit ?allowRawGq escape hatch is present.
    expect(config.source.capabilities().rawGq).toBe(false);
    expect(storage.get("omnigraph_token")).toBe("tok");
  });

  it("enables rawGq only via the ?allowRawGq escape hatch", async () => {
    stubWindow("http://127.0.0.1:5173/?server=http://example.test&graph=acme&allowRawGq=1");
    const config = await buildConfig();
    expect(config.source.capabilities().rawGq).toBe(true);
  });

  it("loads a notebook from the ?notebook= URL", async () => {
    stubWindow("http://127.0.0.1:5173/?notebook=/dash/notebook.yaml&graph=acme");
    const fetch = vi.fn(async (input: URL | string) => {
      const url = String(input);
      if (url === "http://127.0.0.1:5173/dash/notebook.yaml") {
        return response(`
version: 1
title: Remote
server: http://example.test
graph: acme
cells:
  - id: rows
    lens: Table
    query: { ref: decisions_by_urgency }
    props: { columns: [{ key: id, label: ID }] }
`);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    const config = await buildConfig();
    expect(config.notebook.title).toBe("Remote");
    expect(config.label).toContain("graph: acme");
    expect(fetch.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://127.0.0.1:5173/dash/notebook.yaml",
    ]);
  });
});

function stubWindow(href: string): Map<string, string> {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { href, origin: new URL(href).origin },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
  return storage;
}

function response(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as Response;
}
