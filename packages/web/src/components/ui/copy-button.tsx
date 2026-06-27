import React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copy-to-clipboard button for a field value (Table column / Card field with
 * `copy: true`). Stops click propagation so it doesn't trigger row-select, and
 * flips to a check for ~1.2s on success. Clipboard is undefined on non-secure
 * origins — the write is guarded, so it degrades silently. Renders nothing for
 * an empty value.
 */
export function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}): React.ReactElement | null {
  const [copied, setCopied] = React.useState(false);
  if (value === "") return null;

  const copy = (e: React.MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    void (async () => {
      try {
        await navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      } catch {
        /* clipboard unavailable (non-secure context) — no-op */
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy"}
      title="Copy"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
        copied && "opacity-100",
        className,
      )}
    >
      {copied ? (
        <CheckIcon className="size-3 text-primary" />
      ) : (
        <CopyIcon className="size-3" />
      )}
    </button>
  );
}
