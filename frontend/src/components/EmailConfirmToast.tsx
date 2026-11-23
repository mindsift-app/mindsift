import React, { useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { Toast } from './Toast';
import { api } from '../lib/api';

// Link from the mail confirming a new login address (?confirmEmail=…): confirmed right away,
// signed in or not, and the server's answer shown until closed. The token leaves the address bar at once.
export function EmailConfirmToast({ onConfirmed }: { onConfirmed?: () => void }) {
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
    <Toast
      text={result.text}
      icon={<MailCheck className={`w-4 h-4 shrink-0 ${result.ok ? 'text-accent' : ''}`} />}
      tone={result.ok ? 'neutral' : 'err'}
      role={result.ok ? 'status' : 'alert'}
      closable
      onClose={() => setResult(null)}
    />
  );
}
