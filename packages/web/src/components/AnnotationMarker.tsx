import React from "react";
import { A } from "./annotation-style.js";

/**
 * A numbered circular pin (agentation's annotation marker) — 22px blue circle
 * with the annotation's 1-based order in white.
 */
export function AnnotationMarker({ n }: { n: number }): React.ReactElement {
  return (
    <span
      aria-label={`annotation ${n}`}
      title={`annotation ${n}`}
      className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold text-white"
      style={{
        background: A.blue,
        boxShadow: A.markerShadow,
        fontFamily: A.font,
      }}
    >
      {n}
    </span>
  );
}
