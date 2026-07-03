import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * App-wide toast surface: a fixed bottom-right stack, auto-dismissing after
 * 4s, each toast with a manual ✕. Hand-rolled (Base UI 1.5's Toast.Title
 * update-loops under happy-dom, so we keep this dependency-free); the call
 * surface mirrors Base UI's: `useToastManager().add({ title })`.
 */

const TIMEOUT_MS = 4000;
const LIMIT = 3;

interface ToastItem {
  id: number;
  title: string;
}

interface ToastManager {
  add: (options: { title: string }) => void;
}

const ToastContext = createContext<ToastManager | null>(null);

export function useToastManager(): ToastManager {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToastManager must be used within a ToastProvider");
  }
  return ctx;
}

export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback(
    ({ title }: { title: string }) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-(LIMIT - 1)), { id, title }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TIMEOUT_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const manager = useMemo(() => ({ add }), [add]);

  return (
    <ToastContext.Provider value={manager}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg"
            >
              <p className="text-sm text-foreground">{toast.title}</p>
              <button
                type="button"
                aria-label="dismiss"
                className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => dismiss(toast.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
