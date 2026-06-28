/**
 * agentation's visual language — a dark floating chrome that is its own surface
 * regardless of the page theme (so it reads identically over a light or dark
 * notebook). Hex/shadow values lifted from agentation's SCSS modules
 * (annotation-popup-css, page-toolbar-css, annotation-marker).
 */
export const A = {
  blue: "#3b82f6",
  /** Popup/submit accent (agentation's default `accentColor`). */
  accent: "#3c82f7",
  green: "#22c55e",
  red: "#ef4444",
  surface: "#1a1a1a",
  font: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  /** Popup/tooltip shadow — soft drop + 1px inner ring. */
  shadow: "0 4px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.08)",
  /** Toolbar/panel shadow. */
  barShadow: "0 2px 8px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.1)",
  /** Numbered marker shadow. */
  markerShadow: "0 2px 6px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(0, 0, 0, 0.04)",
} as const;
