import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert } from 'lucide-react';
import { toastStack, toastSurface } from './Toast';

const EVENT = 'mindsift:error-notice';

// Shows an error at the bottom of the screen instead of the browser's alert(); callable from anywhere
// (handlers, hooks, outside React). Doku/ui-patterns.md
export function showError(message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

// Mounted once in the app: a red notice with a short shake, gone after a few seconds or on a tap
export const ErrorNoticeHost: React.FC = () => {
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onError = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (!text) return;
      // A new key restarts the shake when the same error comes again
      setNotice({ text, key: Date.now() });
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setNotice(null), 6000);
    };
    window.addEventListener(EVENT, onError);
    return () => {
      window.removeEventListener(EVENT, onError);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!notice) return null;
  // In the shared stack of the notices (Toast.tsx), so it never covers an "Undo" or a status
  return createPortal(
    <div
      key={notice.key}
      role="alert"
      onClick={() => setNotice(null)}
      className={`notice-shake ${toastSurface('err')} px-3 py-2 flex items-center gap-2 cursor-pointer`}
    >
      <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
      <span>{notice.text}</span>
    </div>,
    toastStack()
  );
};
