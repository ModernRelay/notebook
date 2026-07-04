import React, { useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete";

interface EntityPickerItem {
  value: string;
  label: string;
}

export interface EntityPickerProps {
  /** Query result rows the options come from. */
  rows: Record<string, unknown>[];
  /** Column whose value is committed when a row is picked. */
  valueColumn: string;
  /** Display column; defaults to `valueColumn`. */
  labelColumn?: string;
  /** The bound value ("" = nothing picked). */
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Searchable entity picker over query rows — a typeahead combobox that
 * commits the row's `valueColumn` value (never the display label, so
 * duplicate labels stay unambiguous). Base UI's Autocomplete has no
 * selection model of its own: `value` here is the input TEXT; picking is
 * committed via the item's onClick (fires for pointer and keyboard Enter).
 * Used by the query-backed Select cell and the Form `picker` field.
 */
export function EntityPicker({
  rows,
  valueColumn,
  labelColumn,
  value,
  onValueChange,
  placeholder,
  disabled,
}: EntityPickerProps): React.ReactElement {
  const items = useMemo<EntityPickerItem[]>(
    () =>
      rows
        .map((row) => ({
          value: String(row[valueColumn] ?? ""),
          label: String(row[labelColumn ?? valueColumn] ?? row[valueColumn] ?? ""),
        }))
        // "" is the no-selection sentinel — a row without a key can't be picked.
        .filter((item) => item.value !== ""),
    [rows, valueColumn, labelColumn],
  );

  // The committed value's display label; rows not (yet) containing the bound
  // value → show the raw value, still meaningful and still dispatchable.
  const selectedLabel =
    value === ""
      ? ""
      : (items.find((item) => item.value === value)?.label ?? value);
  const [text, setText] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  // Re-reads and external state writes resync the input text — but never
  // while the user is actively searching (popup open): a background re-read
  // that changes the committed value's LABEL must not clobber mid-typing
  // text. The close handler snaps back instead.
  useEffect(() => {
    if (!open) setText(selectedLabel);
  }, [selectedLabel, open]);

  return (
    <Autocomplete
      items={items}
      value={text}
      onValueChange={(next, details) => {
        // Item presses commit through the item's own onClick below.
        if (details.reason === "item-press") return;
        setText(next);
        if (next === "") onValueChange(""); // clearing the input clears the pick
      }}
      onOpenChange={(nextOpen, details) => {
        setOpen(nextOpen);
        // An abandoned edit (blur / escape / outside press) snaps the text
        // back to the committed label; item-press close resyncs via effect.
        if (!nextOpen && details.reason !== "item-press") setText(selectedLabel);
      }}
      openOnInputClick
      autoHighlight
      disabled={disabled}
    >
      <AutocompleteInput
        size="sm"
        placeholder={placeholder ?? "Search…"}
        aria-label={placeholder ?? "Search"}
        showTrigger
        showClear
      />
      <AutocompletePopup>
        <AutocompleteEmpty>No matches</AutocompleteEmpty>
        <AutocompleteList>
          {(item: EntityPickerItem) => (
            <AutocompleteItem
              key={item.value}
              value={item}
              onClick={() => onValueChange(item.value)}
            >
              {item.label}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}
