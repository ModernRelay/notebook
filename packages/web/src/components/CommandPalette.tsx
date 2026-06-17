import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { Fragment, useEffect } from "react";

import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** A pickable row. `label` is what Base UI fuzzy-filters on; `run` fires on pick. */
export interface CommandAction {
  value: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

/** A labelled section of the palette. `value` is the group heading. */
export interface CommandSection {
  value: string;
  items: CommandAction[];
}

/**
 * ⌘K / Ctrl+K command palette, composed with the full COSS Command kit:
 * grouped sections (CommandGroup/Label/Collection) inside a nested CommandPanel,
 * with a CommandFooter of Kbd hints. Built on Base UI Autocomplete — it groups
 * and fuzzy-filters `sections` by each row's `label`, and a row runs its action
 * onClick (Enter activates the highlighted row).
 */
export function CommandPalette({
  open,
  setOpen,
  sections,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  sections: CommandSection[];
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
        <Command items={sections}>
          <CommandInput placeholder="Jump to a cell or run an action…" />
          <CommandPanel>
            <CommandEmpty>No matching commands.</CommandEmpty>
            <CommandList>
              {(group: unknown) => {
                const section = group as CommandSection;
                return (
                  <Fragment key={section.value}>
                    <CommandGroup items={section.items}>
                      <CommandGroupLabel>{section.value}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: unknown) => {
                          const action = item as CommandAction;
                          return (
                            <CommandItem
                              key={action.value}
                              value={action}
                              onClick={() => pick(action)}
                            >
                              <span className="flex-1 truncate">
                                {action.label}
                              </span>
                              {action.shortcut ? (
                                <CommandShortcut>
                                  {action.shortcut}
                                </CommandShortcut>
                              ) : null}
                            </CommandItem>
                          );
                        }}
                      </CommandCollection>
                    </CommandGroup>
                    <CommandSeparator />
                  </Fragment>
                );
              }}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-2">
                <KbdGroup>
                  <Kbd>
                    <ArrowUpIcon />
                  </Kbd>
                  <Kbd>
                    <ArrowDownIcon />
                  </Kbd>
                </KbdGroup>
                Navigate
              </span>
              <span className="flex items-center gap-2">
                <Kbd>
                  <CornerDownLeftIcon />
                </Kbd>
                Open
              </span>
            </div>
            <span className="flex items-center gap-2">
              <Kbd>Esc</Kbd>
              Close
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
