import type { Dispatch, ReactElement, SetStateAction } from "react";
import { useEffect } from "react";

import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

/** One entry in the ⌘K palette. `run` fires when the row is picked. */
export interface CommandAction {
  id: string;
  label: string;
  /** Right-aligned category tag (e.g. "Cell", "Action"). */
  hint?: string;
  run: () => void;
}

/**
 * ⌘K / Ctrl+K command palette. Built on the vendored COSS `Command`
 * (Base UI Autocomplete, selection-mode "none"): it filters `commands` by the
 * typed query via `itemToStringValue`, and each row runs its action `onClick`
 * — which Base UI also fires on Enter for the highlighted row.
 */
export function CommandPalette({
  open,
  setOpen,
  commands,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  commands: CommandAction[];
}): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const pick = (action: CommandAction): void => {
    setOpen(false);
    // Let the dialog close before we scroll / mutate the DOM.
    requestAnimationFrame(() => action.run());
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogPopup aria-label="Command palette">
        <Command
          items={commands}
          itemToStringValue={(item) => (item as CommandAction).label}
        >
          <CommandInput placeholder="Jump to a cell or run an action…" />
          <CommandEmpty>No matching commands.</CommandEmpty>
          <CommandList>
            {(item: unknown) => {
              const action = item as CommandAction;
              return (
                <CommandItem
                  key={action.id}
                  value={action}
                  onClick={() => pick(action)}
                >
                  <span className="truncate">{action.label}</span>
                  {action.hint ? (
                    <CommandShortcut>{action.hint}</CommandShortcut>
                  ) : null}
                </CommandItem>
              );
            }}
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
