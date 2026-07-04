import React, { useMemo, useState } from "react";
import { useActions } from "@json-render/react";
import type { FormField, FormRuntimeProps } from "@modernrelay/notebook-core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as SelectRoot,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EntityPicker } from "./EntityPicker.js";
import { cn } from "@/lib/utils";

interface ComponentCtx<P> {
  props: P;
}

/** Prefill row value → the edit representation each control works with. */
function coerceFromRow(kind: FormField["kind"], v: unknown): unknown {
  switch (kind) {
    case "toggle":
      return Boolean(v);
    case "date":
      // ISO date/datetime string → yyyy-mm-dd for <input type="date">.
      return typeof v === "string" ? v.slice(0, 10) : "";
    case "number":
      // Controlled <input> value is a string; "" = unset.
      return v === null || v === undefined ? "" : String(v);
    default:
      return v === null || v === undefined ? "" : String(v);
  }
}

/** Edit representation → the typed value dispatched via `$input`. */
function coerceForDispatch(kind: FormField["kind"], v: unknown): unknown {
  switch (kind) {
    case "toggle":
      return Boolean(v);
    case "number":
      // Empty number dispatches null — valid only for nullable params;
      // `required: true` is the author's guard for non-nullable ones.
      return v === "" || v === undefined ? null : Number(v);
    default:
      return v ?? "";
  }
}

function sameValue(kind: FormField["kind"], a: unknown, b: unknown): boolean {
  if (kind === "number") {
    const na = a === "" || a === undefined ? null : Number(a);
    const nb = b === "" || b === undefined ? null : Number(b);
    return na === nb;
  }
  return a === b;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Typed edit form over one entity. Edits live in a sparse `values` map
 * (touched fields only); everything else reads through to the prefill
 * baseline, so a post-save re-read makes saved fields clean automatically
 * while a failed field stays dirty. Switching the prefill row's identity
 * (`key_column`) remounts the inner component — edits reset, and a stale
 * edit can never dispatch against a new identity.
 */
export function Form({
  props: p,
}: ComponentCtx<FormRuntimeProps>): React.ReactElement {
  const row = p.rows[0];
  // key_column marks an edit-form (prefill intent): no rows ⇒ nothing to
  // edit. Without it (create-form), an empty result is the normal blank state.
  if (row === undefined && p.key_column !== undefined) {
    return (
      <p className="text-sm italic text-muted-foreground">
        {p.empty_text ?? "(nothing to edit)"}
      </p>
    );
  }
  // Edit-forms remount on prefill-identity change; a create-form (no row)
  // remounts on the last successful submit instead — clearing its fields.
  const rowKey =
    p.key_column !== undefined && row !== undefined
      ? String(row[p.key_column] ?? "")
      : `__static__:${String(row === undefined ? (p.runtime?.last_success_seq ?? 0) : 0)}`;
  return <FormFields key={rowKey} p={p} row={row} />;
}

function FormFields({
  p,
  row,
}: {
  p: FormRuntimeProps;
  row: Record<string, unknown> | undefined;
}): React.ReactElement {
  const actions = useActions();
  const saving = p.runtime?.saving === true;
  // Sparse: only fields the user touched. Untouched fields read the baseline.
  const [values, setValues] = useState<Record<string, unknown>>({});

  const baseline = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of p.fields) {
      out[f.name] = coerceFromRow(f.kind, row?.[f.column ?? f.name]);
    }
    return out;
  }, [p.fields, row]);

  const current = (f: FormField): unknown =>
    f.name in values ? values[f.name] : baseline[f.name];
  const isDirty = (f: FormField): boolean =>
    f.name in values && !sameValue(f.kind, values[f.name], baseline[f.name]);

  const dirty = p.fields.filter(isDirty);
  const missingRequired = p.fields.some(
    (f) => f.required === true && isEmpty(current(f)),
  );
  // The batch: form-level mutations (create-form — fire on every submit),
  // then the dirty fields' own mutations (edit-form). Submit needs at least
  // one edit AND something to dispatch.
  const batch = [
    ...(p.mutations ?? []).map((spec) => ({ spec })),
    ...dirty.flatMap((f) => (f.mutation ? [{ spec: f.mutation }] : [])),
  ];
  const canSubmit =
    dirty.length > 0 && batch.length > 0 && !missingRequired && !saving;

  const submit = (): void => {
    // Full input map (any mutation may reference any field via $input). The
    // prefill row rides along so `{ $row: "<col>" }` identity params resolve
    // at dispatch against the row actually being edited.
    const input: Record<string, unknown> = {};
    for (const f of p.fields) input[f.name] = coerceForDispatch(f.kind, current(f));
    actions.execute({
      action: "mutate",
      params: {
        mutations: batch,
        input,
        ...(row !== undefined ? { row } : {}),
        __cell_id: p.runtime?.cell_id,
      },
    });
  };

  const setField = (name: string, v: unknown): void =>
    setValues((prev) => ({ ...prev, [name]: v }));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
    >
      {p.fields.map((f) => (
        <FieldControl
          key={f.name}
          field={f}
          value={current(f)}
          dirty={isDirty(f)}
          disabled={saving}
          onChange={(v) => setField(f.name, v)}
          options={p.runtime?.field_options?.[f.name]}
          optionsError={p.runtime?.field_options_errors?.[f.name]}
        />
      ))}
      {p.runtime?.error !== undefined && (
        <Alert variant="error">
          <AlertDescription>{p.runtime.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {saving ? "Saving…" : (p.submit_label ?? "Save")}
        </Button>
        {dirty.length > 0 && !saving && (
          <span className="text-xs text-muted-foreground">
            {dirty.length} unsaved {dirty.length === 1 ? "change" : "changes"}
          </span>
        )}
      </div>
    </form>
  );
}

const TEXTAREA_CLASS =
  "min-h-20 w-full rounded-lg border border-input bg-background px-[calc(--spacing(3)-1px)] py-1.5 text-base text-foreground shadow-xs/5 outline-none transition-shadow placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 disabled:opacity-64 sm:text-sm dark:bg-input/32";

function FieldControl({
  field: f,
  value,
  dirty,
  disabled,
  onChange,
  options,
  optionsError,
}: {
  field: FormField;
  value: unknown;
  dirty: boolean;
  disabled: boolean;
  onChange: (v: unknown) => void;
  /** Picker fields: option rows from the runtime's options_query read. */
  options?: Record<string, unknown>[];
  /** Picker fields: options-read failure (stale/empty options shown). */
  optionsError?: string;
}): React.ReactElement {
  const label = f.label ?? f.name;
  const labelEl = (
    <span
      className={cn(
        "w-28 shrink-0 text-sm text-muted-foreground",
        dirty && "font-medium text-foreground",
      )}
    >
      {label}
      {dirty ? " •" : ""}
    </span>
  );

  switch (f.kind) {
    case "picker":
      return (
        <label className="flex items-center gap-2">
          {labelEl}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <EntityPicker
              rows={options ?? []}
              valueColumn={f.value_column ?? f.name}
              labelColumn={f.label_column}
              value={String(value ?? "")}
              onValueChange={(v) => onChange(v)}
              placeholder={f.placeholder}
              disabled={disabled}
            />
            {optionsError !== undefined && (
              <span className="text-xs text-warning">
                ⚠ options unavailable: {optionsError}
              </span>
            )}
          </div>
        </label>
      );
    case "toggle":
      return (
        <label className="flex items-center gap-2">
          {labelEl}
          <Switch
            checked={Boolean(value)}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </label>
      );
    case "select":
      return (
        <label className="flex items-center gap-2">
          {labelEl}
          <SelectRoot
            items={(f.options ?? []).map((o) => ({ label: o, value: o }))}
            value={value === "" || value === undefined ? null : String(value)}
            disabled={disabled}
            onValueChange={(next) => onChange(next == null ? "" : String(next))}
          >
            <SelectTrigger className="w-auto min-w-44">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectPopup>
              {(f.options ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectPopup>
          </SelectRoot>
        </label>
      );
    case "textarea":
      return (
        <label className="flex items-start gap-2">
          {labelEl}
          <textarea
            className={TEXTAREA_CLASS}
            value={String(value ?? "")}
            placeholder={f.placeholder}
            aria-label={f.label ? undefined : f.name}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    case "number":
      return (
        <label className="flex items-center gap-2">
          {labelEl}
          <Input
            type="number"
            value={String(value ?? "")}
            placeholder={f.placeholder}
            min={f.min}
            max={f.max}
            step={f.step}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    case "date":
      return (
        <label className="flex items-center gap-2">
          {labelEl}
          <Input
            type="date"
            value={String(value ?? "")}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    default:
      return (
        <label className="flex items-center gap-2">
          {labelEl}
          <Input
            value={String(value ?? "")}
            placeholder={f.placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}
