/**
 * Global appearance preferences — UI font, mono font, and light/dark theme.
 * Unlike `layout-overrides.ts` (per-notebook), this is a single per-browser
 * setting persisted to localStorage and applied by driving the CSS font
 * variables on `<html>` (and the `.dark` class). `applyAppearance` touches the
 * document; `load`/`save`/the stack maps are pure and unit-testable.
 */

export type UiFont = "inter" | "geist" | "urbanist";
export type MonoFont = "geist-mono" | "jetbrains";
export type Theme = "light" | "dark";

export interface Appearance {
  uiFont: UiFont;
  monoFont: MonoFont;
  theme: Theme;
}

export const DEFAULT_APPEARANCE: Appearance = {
  uiFont: "inter",
  monoFont: "geist-mono",
  theme: "light",
};

const KEY = "dashbook:appearance:v1";

/** Menu options (value + human label), in display order. */
export const UI_FONTS: { value: UiFont; label: string }[] = [
  { value: "inter", label: "Inter" },
  { value: "geist", label: "Geist" },
  { value: "urbanist", label: "Urbanist" },
];

export const MONO_FONTS: { value: MonoFont; label: string }[] = [
  { value: "geist-mono", label: "Geist Mono" },
  { value: "jetbrains", label: "JetBrains" },
];

/** font-family stacks — must match the families @fontsource registers in main.tsx. */
export const UI_STACKS: Record<UiFont, string> = {
  inter: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  geist: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  urbanist: '"Urbanist Variable", ui-sans-serif, system-ui, sans-serif',
};

export const MONO_STACKS: Record<MonoFont, string> = {
  "geist-mono": '"Geist Mono Variable", ui-monospace, monospace',
  jetbrains: '"JetBrains Mono Variable", ui-monospace, monospace',
};

function isUiFont(v: unknown): v is UiFont {
  return v === "inter" || v === "geist" || v === "urbanist";
}
function isMonoFont(v: unknown): v is MonoFont {
  return v === "geist-mono" || v === "jetbrains";
}
function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark";
}

export function loadAppearance(): Appearance {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const p = JSON.parse(raw) as Partial<Appearance>;
    return {
      uiFont: isUiFont(p.uiFont) ? p.uiFont : DEFAULT_APPEARANCE.uiFont,
      monoFont: isMonoFont(p.monoFont) ? p.monoFont : DEFAULT_APPEARANCE.monoFont,
      theme: isTheme(p.theme) ? p.theme : DEFAULT_APPEARANCE.theme,
    };
  } catch {
    return DEFAULT_APPEARANCE; // unparseable / unavailable storage → defaults
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* private mode / quota — best-effort */
  }
}

/** Apply to the document: font CSS vars on `<html>` + the `.dark` class. */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  const ui = UI_STACKS[a.uiFont];
  root.style.setProperty("--font-sans", ui);
  root.style.setProperty("--font-heading", ui);
  root.style.setProperty("--font-mono", MONO_STACKS[a.monoFont]);
  root.classList.toggle("dark", a.theme === "dark");
}
