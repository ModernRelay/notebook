import React from "react";

/** A small dot shown beside an annotated entity in annotate mode. */
export function AnnotationMarker(): React.ReactElement {
  return (
    <span
      aria-label="annotated"
      title="annotated"
      className="inline-block size-1.5 shrink-0 rounded-full bg-primary"
    />
  );
}
