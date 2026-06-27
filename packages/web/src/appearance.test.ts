import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APPEARANCE,
  MONO_FONTS,
  MONO_STACKS,
  UI_FONTS,
  UI_STACKS,
  applyAppearance,
  loadAppearance,
  saveAppearance,
} from "./appearance.js";

function stubStorage(): Map<string, string> {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
    },
  });
  return storage;
}

describe("appearance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to inter / geist-mono / light", () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      uiFont: "inter",
      monoFont: "geist-mono",
      theme: "light",
    });
  });

  it("every menu option maps to a font stack", () => {
    for (const f of UI_FONTS) expect(UI_STACKS[f.value]).toContain("Variable");
    for (const f of MONO_FONTS)
      expect(MONO_STACKS[f.value]).toContain("Variable");
    expect(UI_STACKS.geist).toMatch(/^"Geist Variable"/);
    expect(MONO_STACKS.jetbrains).toMatch(/^"JetBrains Mono Variable"/);
  });

  it("returns defaults for empty / unparseable storage", () => {
    const s = stubStorage();
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
    s.set("dashbook:appearance:v1", "{not json");
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it("save → load round-trips a valid appearance", () => {
    stubStorage();
    const a = {
      uiFont: "urbanist",
      monoFont: "jetbrains",
      theme: "dark",
    } as const;
    saveAppearance(a);
    expect(loadAppearance()).toEqual(a);
  });

  it("keeps defaults for invalid fields", () => {
    const s = stubStorage();
    s.set(
      "dashbook:appearance:v1",
      JSON.stringify({ uiFont: "comic", theme: "neon" }),
    );
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it("applyAppearance sets font vars + the dark class on the root", () => {
    const props = new Map<string, string>();
    let darkOn: boolean | null = null;
    vi.stubGlobal("document", {
      documentElement: {
        style: {
          setProperty: (k: string, v: string) => {
            props.set(k, v);
          },
        },
        classList: {
          toggle: (_c: string, on: boolean) => {
            darkOn = on;
          },
        },
      },
    });
    applyAppearance({ uiFont: "geist", monoFont: "jetbrains", theme: "dark" });
    expect(props.get("--font-sans")).toMatch(/Geist Variable/);
    expect(props.get("--font-heading")).toMatch(/Geist Variable/);
    expect(props.get("--font-mono")).toMatch(/JetBrains Mono Variable/);
    expect(darkOn).toBe(true);
  });
});
