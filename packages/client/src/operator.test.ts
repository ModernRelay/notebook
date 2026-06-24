import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConnection } from "./operator.js";

const ENV_KEYS = [
  "OMNIGRAPH_HOME",
  "OMNIGRAPH_PROFILE",
  "OMNIGRAPH_BEARER_TOKEN",
  "OMNIGRAPH_TOKEN_PROD",
];

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "og-home-"));
  process.env.OMNIGRAPH_HOME = dir;
  return dir;
}

describe("resolveConnection", () => {
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("uses a literal URL server + flag graph + bearer-token env", () => {
    freshHome();
    process.env.OMNIGRAPH_BEARER_TOKEN = "tok";
    const r = resolveConnection({ server: "http://x.test", graph: "g" }, {});
    expect(r.baseUrl).toBe("http://x.test");
    expect(r.graphId).toBe("g");
    expect(r.token).toBe("tok");
  });

  it("falls back to the notebook's server + graph", () => {
    freshHome();
    const r = resolveConnection({}, { server: "http://nb.test", graph: "company" });
    expect(r.baseUrl).toBe("http://nb.test");
    expect(r.graphId).toBe("company");
  });

  it("resolves a named server + keyed token from operator config", () => {
    const dir = freshHome();
    writeFileSync(
      join(dir, "config.yaml"),
      `servers:\n  prod: { url: https://prod.example }\ndefaults:\n  server: prod\n  default_graph: knowledge\n`,
    );
    process.env.OMNIGRAPH_TOKEN_PROD = "keyed";
    const r = resolveConnection({}, {});
    expect(r.baseUrl).toBe("https://prod.example");
    expect(r.graphId).toBe("knowledge");
    expect(r.token).toBe("keyed");
  });

  it("reads a token from the 0600 credentials file", () => {
    const dir = freshHome();
    writeFileSync(
      join(dir, "config.yaml"),
      `servers:\n  prod: { url: https://prod.example }\n`,
    );
    const cred = join(dir, "credentials");
    writeFileSync(cred, `[prod]\ntoken = from-file\n`);
    chmodSync(cred, 0o600);
    const r = resolveConnection({ server: "prod", graph: "g" }, {});
    expect(r.token).toBe("from-file");
  });

  it("throws on a missing graph", () => {
    freshHome();
    expect(() => resolveConnection({ server: "http://x.test" }, {})).toThrow(
      /graph id/,
    );
  });

  it("throws on a missing server", () => {
    freshHome();
    expect(() => resolveConnection({ graph: "g" }, {})).toThrow(/no server/);
  });

  it("refuses an over-permissive credentials file", () => {
    if (process.platform === "win32") return;
    const dir = freshHome();
    writeFileSync(
      join(dir, "config.yaml"),
      `servers:\n  prod: { url: https://prod.example }\n`,
    );
    const cred = join(dir, "credentials");
    writeFileSync(cred, `[prod]\ntoken = x\n`);
    chmodSync(cred, 0o644);
    expect(() => resolveConnection({ server: "prod", graph: "g" }, {})).toThrow(
      /over-permissive/,
    );
  });
});
