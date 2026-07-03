# Mutation epic — input → write, the missing layer

State-of-affairs map for the notebook **write path** and a roadmap for the layer
that's missing. Baseline: `main` after **#10** (server-aware mutations: `ref`/`rawGq`,
hardcoded `slug` identity removed) and **#11** (canvas/RGL). Companion to
`dash-books-canon.md` §4.1/§4.5.

## TL;DR

The **write *contract* is right** — mutations are server-owned catalog operations
(`mutation.ref`), typed-param, edge-capable, identity-server-side, seq-guarded
optimistic, branch-aware. What's missing is the **input + feedback + invalidation
layer on top**: there is exactly **one** way to trigger a write (an `ActionList`
row button), and the only param sources are the clicked row (`$row`), notebook
state (`$state`), and literals. There is **no typed user input** (text / number /
checkbox / date / entity-picker), **no form**, and **no result feedback**.

## 1. How writes work today

**The only trigger: an `ActionList` row button.**

```
ActionList row button
  props.actions[*].mutation = MutationSpec { ref XOR rawGq, params, optimistic.set }
        │  click → actions.execute("mutate", { spec, row, rowKey, __cell_id })
        ▼
NotebookRuntime.dispatchMutation            (core/runtime/runtime.ts:161)
   • resolveMutationParams(spec.params, row, state)   → $row / $state / literal   (resolve.ts)
   • seq = ++; optimistic overlay from spec.optimistic.set, keyed (cellId,rowKey,field)
   • on success: finalize patch (if still owned) + rerunCells(ALL data cells)     (runtime.ts:225)
   • on error:   delete owned patch + set snapshot.mutationError
        │  Source.mutate({ params, resolvedParams, cellId }, { writeTarget, … })
        ▼
ServerSource.mutate                          (client/src/source.ts:87)
   • ref   → client.invokeMutation(ref, { params, branch })   (one commit; server owns `where`)
   • rawGq → client.mutate({ query, name, params, branch })
   • returns { kind: "ok" }  — the SDK result is discarded (source.ts:120 `void result`)
```

**Controls don't mutate.** `Button` / `Toggle` / `Select` only read/write **state**
(`$bindState`, `on.press → setState`). A mutation param reads that via `{$state}`.
That state bus is the *entire* current "input → mutation" path.

**Param markers** (the resolver, `resolveExpr`): `{$row: col}` (clicked row),
`{$state: ptr}`, nested arrays/objects, else literal. No other source.

## 2. Matrix A — mutation capability coverage

| Pattern | Trigger today | Param source | Optimistic | Result feedback | Status |
|---|---|---|---|---|---|
| Update field, **no input** (Approve/Reject) | ActionList row button | `$row`, literal | ✅ `optimistic.set` overlay | ❌ → full re-read | ✅ works |
| Update via **selection elsewhere** | ActionList button + Select/Table → `$state` | `$state` | ✅ overlay | ❌ | ✅ works (`/sel/decision`) |
| Update with a **typed user value** (reason/priority/rename) | — | — | — | — | ❌ **missing** |
| **Create** a node (form of fields) | — | — | — | — | ❌ **missing** (no form, no non-row trigger) |
| Insert an **edge** (A→B) | ActionList button (A=`$row`, B=`$state`) | `$row`+`$state` | ❌ no insert overlay | ❌ | 🟡 works, no optimistic |
| **Delete** a row (+ confirm) | ActionList button (possible) | `$row` | ❌ no remove overlay | ❌ | 🟡 possible; no confirm/optimistic-remove |
| **Inline-edit** a table cell | — | — | — | — | ❌ missing |
| **Bulk** / multi-row | — | — | — | — | ❌ missing (per-row only) |
| **Staged/transactional** batch (branch→review→commit) | — | `writeTarget.branch` exists | — | — | ❌ missing (Phase 3 canon) |

## 3. Matrix B — input primitives → mutation params

| Primitive | Exists | Writes to | Reaches a mutation via | Key gap |
|---|---|---|---|---|
| **ActionList row button** | ✅ | fires `mutate` | `$row` / `$state` / literal | the **only** direct trigger; **row-scoped only** |
| Button (`on.press`) | ✅ | emits `press` → action | handler-bound (demo) / `setState` | carries no row ⇒ can't fire row-scoped `mutate`; no value |
| Toggle | ✅ | `$bindState` (bool) | `{$state}` | boolean only; no submit grouping |
| Select | ✅ | `$bindState`/`setState` | `{$state}` | **static options only** (no query-driven picker) |
| **TextInput** | ❌ | — | — | missing |
| **NumberInput** | ❌ | — | — | missing |
| **Checkbox / multi-select** | ❌ | — | — | missing |
| **DatePicker** | ❌ | — | — | missing |
| **Query/entity picker** | ❌ | — | — | missing (pick a node from a query) |
| **Form** (grouped fields + submit) | ❌ | — | — | missing — no field-group → one submit |
| param marker `{$input}` / `$form` | ❌ | — | — | missing — only `$row`/`$state`/literal |

## 4. Reliability & correctness issues

1. **No-op writes report success.** `MutationResult={kind:"ok"}`; the SDK result is
   discarded (`source.ts:120`). A mutation matching **0 rows** "succeeds" silently —
   no rows-affected, no confirmation, no no-op detection.
2. **Broad invalidation.** Success → `rerunCells(dataCellIds)` (`runtime.ts:225`)
   re-reads **every** data cell (N round-trips + global pending flicker per write).
3. **Optimistic is ActionList-only + update-only** (`runtime.ts:411`). Inserts/deletes
   get no optimistic feedback.
4. **No submit-time guard.** A missing `$state` resolves to `undefined` and is sent
   anyway → server error (e.g. "Raise" with nothing selected). Nothing disables until
   inputs are valid.
5. **Coarse error surface.** One global `snapshot.mutationError` banner; per-row
   `patch.error` exists but there's no **retry**, no per-field error.
6. **No confirmation / destructive guard.** Reject/Delete fire immediately.

## 5. The epic — what's missing

The absent system: **typed user input → mutation params, driven by the mutation's
own catalog schema.** Concretely:
- input controls: **TextInput / NumberInput / Checkbox / DatePicker / query-backed
  entity-Select**;
- a **`Form` lens** that groups fields and submits one mutation — **schema-driven**
  off the catalog mutation's typed params (string→text, bool→checkbox, enum→select,
  ref→picker) — the payoff #10 unlocked;
- a **`{$input}` / `$form` param marker** (an additive branch in `resolveExpr`);
- **create/delete** first-class (non-row trigger, optimistic insert/remove, confirm);
- **mutation result feedback** (rows-affected / returned data → toast, no-op detect,
  optimistic-from-result);
- **targeted re-read** (declare/infer affected cells instead of all);
- **branch staging UI** (stage → review → commit).

## 6. Proposed phases

> Each phase is independently shippable and layers on the prior. Schema-driven is the
> through-line: the catalog mutation's typed params should *drive* the form.

- **P1 — Form + `{$input}` + submit guard.** A `Form` lens (a non-row mutation
  trigger): authored fields → a form-scoped value bag → submit fires one `mutate`
  with `params` reading `{$input: field}`. New `{$input}` branch in `resolveExpr`;
  `MutationParams` gains the form bag. Submit disabled until required params resolve
  (fixes #4). *Minimal set of field types: text, number, checkbox, select.*
- **P2 — Input control primitives.** `TextInput` / `NumberInput` / `Checkbox` /
  `DatePicker` / query-backed `Select` (entity picker) — as both standalone controls
  (write `$state`) and form fields (write the form bag). TUI parity is best-effort.
- **P3 — Result feedback + targeted re-read.** `MutationResult` carries
  rows-affected / returned rows; surface a confirmation + **no-op detection**; let a
  mutation declare/infer the cells it invalidates → re-read only those (fixes #1, #2).
- **P4 — Create / delete / confirm.** First-class create (form, not row-bound) and
  delete with a confirm-guard primitive; optimistic insert/remove overlays beyond
  ActionList (fixes #3, #6).
- **P5 — Schema introspection.** Read the catalog mutation's param types and
  auto-generate / validate the form (the full payoff of server-owned mutations).
- **P6 — Branch staging (Phase-3 canon).** Stage multiple writes on a branch; a
  review surface; commit/merge.

## Open decisions
- **`{$input}` vs reuse `$state`.** A form could just write a scoped `$state` subtree
  (no new marker) — simpler, but conflates transient form input with shared selection
  state. A distinct `$form`/`$input` scope is cleaner but adds a marker.
- **Schema source.** Does the catalog expose mutation param *types* richly enough to
  drive control selection, or do authors annotate field types in the `Form` spec?
- **Optimistic for insert/delete.** Needs a row-identity + a "phantom row" model in
  lenses, not just a field overlay.
- **Targeted invalidation.** Declared (author lists affected cells) vs inferred
  (which queries touch the mutated type/edge) — the latter needs catalog metadata.
