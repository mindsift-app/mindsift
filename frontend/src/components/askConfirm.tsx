import React, { useEffect, useState } from 'react';
import { ConfirmPopover } from './ConfirmPopover';

const EVENT = 'mindsift:ask-confirm';

interface ConfirmRequest {
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

// Where the last click or tap was: the question opens right there, like ConfirmPopover elsewhere
let lastPointer = { x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0, y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastPointer = { x: e.clientX, y: e.clientY }), true);
}

// The app's own confirmation instead of the browser's confirm(): resolves true on confirm, false on
// cancel, Escape or a click outside. Callable from handlers and hooks without state of their own.
export function askConfirm(opts: { message: React.ReactNode; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<ConfirmRequest>(EVENT, { detail: { ...opts, resolve } }));
  });
}

// Mounted once in the app
export const ConfirmHost: React.FC = () => {
  const [req, setReq] = useState<(ConfirmRequest & { x: number; y: number }) | null>(null);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<ConfirmRequest>).detail;
      setReq((prev) => {
        prev?.resolve(false); // a new question replaces an open one
        return { ...detail, ...lastPointer };
      });
    };
    window.addEventListener(EVENT, onAsk);
    return () => window.removeEventListener(EVENT, onAsk);
  }, []);

  if (!req) return null;
  const close = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };
  return (
    <ConfirmPopover
      x={req.x}
      y={req.y}
      message={req.message}
      confirmLabel={req.confirmLabel}
      danger={req.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );
};
