import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Overlay primitive for the notebook layout tier (cell `display: drawer|modal`).
 *
 * `drawer` slides a right-anchored panel in from the edge; `modal` fades a
 * centered card. Both wrap base-ui `Dialog` and are fully controlled: the host
 * shell drives `open` from notebook state (an `open_state` JSON-pointer) and
 * clears that pointer in `onClose`. We pass `modal="trap-focus"` so the
 * underlying cell stack stays scrollable behind the drawer.
 */
export function Overlay({
  open,
  onClose,
  title,
  variant = "drawer",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  variant?: "drawer" | "modal";
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      modal="trap-focus"
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/32 backdrop-blur-sm transition-opacity duration-200",
            "data-ending-style:opacity-0 data-starting-style:opacity-0",
          )}
        />
        <Dialog.Popup
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border bg-popover text-popover-foreground shadow-lg outline-none",
            variant === "drawer"
              ? [
                  "inset-y-0 right-0 w-full max-w-lg border-l",
                  "transition-transform duration-300 ease-out",
                  "data-ending-style:translate-x-full data-starting-style:translate-x-full",
                ]
              : [
                  "left-1/2 top-1/2 max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl",
                  "transition-[opacity,scale] duration-200 ease-out",
                  "data-ending-style:scale-98 data-starting-style:scale-98",
                  "data-ending-style:opacity-0 data-starting-style:opacity-0",
                ],
          )}
        >
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
            <Dialog.Title className="truncate font-heading text-base font-semibold text-foreground">
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <XIcon className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
