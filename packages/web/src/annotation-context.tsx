import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Notebook } from "@modernrelay/notebook-core";
import {
  annotationId,
  annotationsKey,
  clearAnnotations,
  loadAnnotations,
  saveAnnotations,
  serializeAnnotations,
  type Annotation,
  type AnnotationIntent,
  type AnnotationSession,
} from "./annotations-store.js";

/** What a lens passes when an entity is clicked for annotation. */
export interface AnnotationDraft {
  key: string;
  headline: string;
  data: Record<string, unknown>;
}

/** The in-flight popup target — an entity click awaiting a note. */
export interface PendingAnnotation {
  cellId: string;
  lens: string;
  queryRef?: string;
  draft: AnnotationDraft;
  /** Anchor rect (viewport coords) of the clicked element, for popup placement. */
  rect: { top: number; left: number; bottom: number; right: number; width: number };
  existing?: Annotation;
}

interface GlobalValue {
  active: boolean;
  open(
    target: {
      cellId: string;
      lens: string;
      queryRef?: string;
      draft: AnnotationDraft;
    },
    rect: DOMRect,
  ): void;
  /** 1-based annotation order for this entity, or null when not annotated. */
  numberOf(cellId: string, key: string): number | null;
}

const GlobalContext = createContext<GlobalValue | null>(null);

interface CellValue {
  cellId: string;
  lens: string;
  queryRef?: string;
}
const CellContext = createContext<CellValue | null>(null);

export function AnnotationGlobalProvider({
  value,
  children,
}: {
  value: GlobalValue;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <GlobalContext.Provider value={value}>{children}</GlobalContext.Provider>
  );
}

/** Wraps each cell's `<Renderer>` so its leaf lens learns its cell id/lens/query. */
export function AnnotationCellProvider({
  cellId,
  lens,
  queryRef,
  children,
}: {
  cellId: string;
  lens: string;
  queryRef?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const value = useMemo(
    () => ({ cellId, lens, queryRef }),
    [cellId, lens, queryRef],
  );
  return <CellContext.Provider value={value}>{children}</CellContext.Provider>;
}

/** Leaf-lens hook: annotate-on-click + per-entity marker number for this cell. */
export function useAnnotation(): {
  active: boolean;
  annotate: (draft: AnnotationDraft, e: React.MouseEvent) => void;
  /** 1-based marker number for this entity, or null when not annotated. */
  numberOf: (key: string) => number | null;
} {
  const g = useContext(GlobalContext);
  const c = useContext(CellContext);
  const active = g?.active ?? false;
  const annotate = useCallback(
    (draft: AnnotationDraft, e: React.MouseEvent) => {
      if (!g || !c) return;
      e.stopPropagation();
      g.open(
        { cellId: c.cellId, lens: c.lens, queryRef: c.queryRef, draft },
        (e.currentTarget as HTMLElement).getBoundingClientRect(),
      );
    },
    [g, c],
  );
  const numberOf = useCallback(
    (key: string) => (g && c ? g.numberOf(c.cellId, key) : null),
    [g, c],
  );
  return { active, annotate, numberOf };
}

/** Host hook: owns the persisted session, annotate mode, and the popup target. */
export function useAnnotations(notebook: Notebook, label: string) {
  const storageKey = useMemo(() => annotationsKey(notebook), [notebook]);
  const [session, setSession] = useState<AnnotationSession>(() =>
    loadAnnotations(storageKey),
  );
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState<PendingAnnotation | null>(null);

  const persist = useCallback(
    (next: AnnotationSession) => {
      setSession(next);
      saveAnnotations(storageKey, next);
    },
    [storageKey],
  );

  const open = useCallback<GlobalValue["open"]>(
    (target, rect) => {
      const id = annotationId(target.cellId, target.draft.key);
      setPending({
        ...target,
        rect: {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          width: rect.width,
        },
        existing: session.items.find((a) => a.id === id),
      });
    },
    [session.items],
  );

  const numberOf = useCallback(
    (cellId: string, key: string) => {
      const i = session.items.findIndex(
        (a) => a.id === annotationId(cellId, key),
      );
      return i === -1 ? null : i + 1;
    },
    [session.items],
  );

  const save = useCallback(
    (note: string, intent?: AnnotationIntent) => {
      if (!pending) return;
      const a: Annotation = {
        id: annotationId(pending.cellId, pending.draft.key),
        cellId: pending.cellId,
        lens: pending.lens,
        ...(pending.queryRef ? { queryRef: pending.queryRef } : {}),
        key: pending.draft.key,
        headline: pending.draft.headline,
        data: pending.draft.data,
        note,
        ...(intent ? { intent } : {}),
      };
      persist({
        ...session,
        items: [...session.items.filter((x) => x.id !== a.id), a],
      });
      setPending(null);
    },
    [pending, session, persist],
  );

  const remove = useCallback(
    (id: string) => {
      persist({ ...session, items: session.items.filter((a) => a.id !== id) });
      setPending(null);
    },
    [session, persist],
  );

  const setInstruction = useCallback(
    (instruction: string) => persist({ ...session, instruction }),
    [session, persist],
  );

  const clear = useCallback(() => {
    persist({ items: [], instruction: "" });
    clearAnnotations(storageKey);
  }, [persist, storageKey]);

  const copy = useCallback(async (): Promise<boolean> => {
    const md = serializeAnnotations(notebook, label, session);
    try {
      await navigator.clipboard?.writeText(md);
      return true;
    } catch {
      return false;
    }
  }, [notebook, label, session]);

  const globalValue = useMemo<GlobalValue>(
    () => ({ active, open, numberOf }),
    [active, open, numberOf],
  );

  return {
    active,
    setActive,
    session,
    pending,
    closePopup: useCallback(() => setPending(null), []),
    save,
    remove,
    setInstruction,
    clear,
    copy,
    globalValue,
  };
}
