import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MailCheck, X } from 'lucide-react';
import { api } from '../lib/api';

// Link from the mail confirming a new login address (?confirmEmail=…): confirmed right away,
// signed in or not, and the server's answer shown until closed. The token leaves the address bar at once.
export function EmailConfirmToast({ onConfirmed }: { onConfirmed?: () => void }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('confirmEmail');
    if (!token) return;
    url.searchParams.delete('confirmEmail');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    api
      .confirmEmailChange(token)
      .then((res) => {
        setResult({ ok: true, text: res.message });
        onConfirmed?.();
      })
      .catch((err) => setResult({ ok: false, text: err.message }));
    // Once per page load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result) return null;
  return (
    <div
      role="status"
      className="fixed z-[70] left-4 right-4 sm:left-auto sm:right-6 sm:w-96 top-[calc(4.5rem+env(safe-area-inset-top))] sm:top-auto sm:bottom-6 p-3 rounded-xl border border-border bg-panel shadow-lg flex items-start gap-2.5 text-sm"
    >
      <MailCheck className={`w-4 h-4 mt-0.5 flex-shrink-0 ${result.ok ? 'text-accent' : 'text-status-err'}`} />
      <p className="flex-1 min-w-0 text-main">{result.text}</p>
      <button
        type="button"
        onClick={() => setResult(null)}
        title={t('close')}
        aria-label={t('close')}
        className="h-11 w-11 sm:h-7 sm:w-7 -m-1.5 flex items-center justify-center rounded-lg text-muted hover:text-main"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
