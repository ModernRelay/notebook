import React from "react";
import Markdown from "react-markdown";
import type { TextRuntimeProps } from "@modernrelay/notebook-core";

interface ComponentCtx<P> {
  props: P;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

// Prose typography via Tailwind child-selectors (no typography plugin). Tailwind
// emits these literal arbitrary variants; the markdown output inherits them.
const PROSE =
  "max-w-prose break-words text-sm leading-relaxed text-foreground " +
  "[&_p]:my-2 [&_a]:text-primary [&_a]:underline " +
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold " +
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold " +
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground";

export function Text({
  props: p,
}: ComponentCtx<TextRuntimeProps>): React.ReactElement {
  const row = p.rows[0];
  const body = row ? asText(row[p.text_column ?? ""]) : "";
  if (!row || body.trim() === "") {
    return (
      <p className="text-sm italic text-muted-foreground">
        {p.empty_text ?? "(no text)"}
      </p>
    );
  }
  const title = p.title_column ? asText(row[p.title_column]) : "";
  return (
    <div>
      {title && (
        <h3 className="mb-2 text-base font-semibold text-foreground">{title}</h3>
      )}
      <div className={PROSE}>
        {/* No rehype-raw → raw HTML in the text is ignored (XSS-safe). Links
            open in a new tab. */}
        <Markdown
          components={{
            a({ node: _node, ...rest }) {
              return <a target="_blank" rel="noopener noreferrer" {...rest} />;
            },
          }}
        >
          {body}
        </Markdown>
      </div>
    </div>
  );
}
