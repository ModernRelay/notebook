import { useEffect, useRef } from "react";

/**
 * A keyboard chord: modifiers + a physical key `code` (e.g. "KeyD", "Digit1",
 * "ArrowUp"). Matching on `code` is layout- and Option-glyph-proof (on macOS
 * ⌥1 yields `key: "¡"` but `code: "Digit1"`). One chord drives both the
 * displayed badge (`formatChord`) and the binding (`useHotkeys`) — single
 * source of truth, no drift.
 */
export interface Chord {
  /** ⌘ on macOS / Ctrl elsewhere — matched as metaKey OR ctrlKey. */
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** A `KeyboardEvent.code` value, e.g. "KeyD", "Digit1", "ArrowUp". */
  code: string;
}

export interface Hotkey {
  chord: Chord;
  run: () => void;
}

const KEY_SYMBOL: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "⏎",
  Escape: "Esc",
  Space: "Space",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

function keyLabel(code: string): string {
  if (KEY_SYMBOL[code]) return KEY_SYMBOL[code];
  if (code.startsWith("Key")) return code.slice(3); // KeyD → D
  if (code.startsWith("Digit")) return code.slice(5); // Digit1 → 1
  return code;
}

/** Render a chord as a badge string, e.g. "⌘D", "⌥1", "⌘↑". */
export function formatChord(chord: Chord): string {
  return (
    (chord.meta ? "⌘" : "") +
    (chord.alt ? "⌥" : "") +
    (chord.shift ? "⇧" : "") +
    keyLabel(chord.code)
  );
}

function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  const meta = event.metaKey || event.ctrlKey;
  return (
    meta === Boolean(chord.meta) &&
    event.altKey === Boolean(chord.alt) &&
    event.shiftKey === Boolean(chord.shift) &&
    event.code === chord.code
  );
}

// Native form fields plus widgets that render as a button/role rather than a
// native tag — notably Base UI Select (its trigger is a <button role=combobox>
// and its popup uses role=listbox/option), Menu, and Dialog. Focus on (or
// within) any of these is treated as "interactive".
const INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[role='combobox']",
  "[role='listbox']",
  "[role='option']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='dialog']",
  "[role='textbox']",
  "[role='searchbox']",
].join(",");

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest(INTERACTIVE_SELECTOR) !== null;
}

/**
 * Install a single keydown listener that fires the first matching hotkey.
 * Bindings may change every render (e.g. the dynamic cell list), so a ref keeps
 * the listener itself stable. While focus is on an interactive control (a form
 * field, button, or Base UI Select/menu/dialog) only ⌘/Ctrl chords fire, so a
 * bare "⌥1" can't hijack a filter mid-interaction while "⌘K" still toggles the
 * palette.
 */
export function useHotkeys(hotkeys: Hotkey[]): void {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const interactive = isInteractiveTarget(event.target);
      for (const hotkey of ref.current) {
        if (interactive && !hotkey.chord.meta) continue;
        if (matchesChord(event, hotkey.chord)) {
          event.preventDefault();
          hotkey.run();
          return;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
