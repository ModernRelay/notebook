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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Install a single keydown listener that fires the first matching hotkey.
 * Bindings may change every render (e.g. the dynamic cell list), so a ref keeps
 * the listener itself stable. Inside editable fields only ⌘/Ctrl chords fire,
 * so typing "⌥1" inserts text while "⌘K" still toggles the palette.
 */
export function useHotkeys(hotkeys: Hotkey[]): void {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const editable = isEditableTarget(event.target);
      for (const hotkey of ref.current) {
        if (editable && !hotkey.chord.meta) continue;
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
