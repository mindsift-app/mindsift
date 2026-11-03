import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastMessage = { text: string; actions: { label: string; run: () => void }[] };

// Short message at the bottom of the workspace, optionally with actions such as "Undo"
// (longer when it has one)
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((text: string, actions: { label: string; run: () => void }[] = []) => {
    setToast({ text, actions });
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), actions.length ? 10000 : 4000);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);
  return { toast, setToast, showToast };
}

export function WorkspaceToast({
  toast,
  setToast,
}: {
  toast: ToastMessage | null;
  setToast: (toast: ToastMessage | null) => void;
}) {
  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-6 z-50 max-w-[calc(100vw-1.5rem)] px-3 py-2 rounded-card text-xs text-main bg-panel-elevated border border-border shadow-panel flex items-center gap-3"
    >
      <span>{toast.text}</span>
      {toast.actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={() => {
            setToast(null);
            a.run();
          }}
          className="font-semibold text-accent hover:underline min-h-[44px] sm:min-h-0 shrink-0"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
